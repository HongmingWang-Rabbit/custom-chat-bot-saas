/**
 * RAG Service
 *
 * Orchestrates the complete RAG pipeline:
 * 1. Retrieve relevant chunks from vector store
 * 2. Build context with citations
 * 3. Generate response with LLM
 * 4. Parse and format citations
 */

import { TenantDatabase } from '@/db';
import { RAGConfig } from '@/db/schema/main';
import { qaLogs, NewQALog } from '@/db/schema/tenant';
import { createLLMAdapterFromConfig, LLMAdapter, buildRAGSystemPrompt, buildRAGUserPrompt } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { getRAGCacheService, RAGCacheService } from '@/lib/cache';
import { retrieveWithConfig, RetrievedChunk, rerankChunks } from './retrieval';
import {
  summarizeDocuments,
  isBroadQuestion,
  buildSummaryContext,
  DocumentSummary,
} from './summarization';
import {
  DEFAULT_TOP_K,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_RAG_MAX_TOKENS,
  DEFAULT_RAG_TEMPERATURE,
  GREETING_PATTERNS,
  HELP_PATTERNS,
  SUMMARIZATION_ENABLED,
} from './config';
import {
  buildCitationContext,
  parseCitations,
  calculateOverallConfidence,
  Citation,
  CitedResponse,
} from './citations';

// Create a child logger for RAG service
const log = logger.child({ layer: 'rag', service: 'RAGService' });

// =============================================================================
// Types
// =============================================================================

export interface RAGRequest {
  query: string;
  tenantSlug: string;
  sessionId?: string;
}

export interface RAGResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  retrievedChunks: number;
  tokensUsed: {
    embedding: number;
    completion: number;
  };
  timing: {
    retrieval_ms: number;
    llm_ms: number;
  };
}

export type RAGStatus =
  | 'searching'      // Searching knowledge base
  | 'generating';    // Generating response

export interface RAGStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onComplete?: (response: RAGResponse) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: RAGStatus) => void;
}

// =============================================================================
// RAG Service Class
// =============================================================================

export class RAGService {
  private db: TenantDatabase;
  private llm: LLMAdapter;
  private ragConfig: RAGConfig;
  private tenantSlug: string;
  private llmApiKey: string | null;
  private cacheService: RAGCacheService;

  constructor(
    db: TenantDatabase,
    llmApiKey: string | null,
    ragConfig: Partial<RAGConfig> = {},
    tenantSlug: string
  ) {
    this.db = db;
    this.llmApiKey = llmApiKey;
    this.llm = createLLMAdapterFromConfig('openai', llmApiKey);
    // Use defaults for topK and confidenceThreshold to ensure new retrieval system works
    // Tenant config can override chunk settings but not retrieval params (for now)
    this.ragConfig = {
      topK: DEFAULT_TOP_K,
      confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
      chunkSize: ragConfig.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: ragConfig.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    };
    this.tenantSlug = tenantSlug;
    this.cacheService = getRAGCacheService();
  }

  /**
   * Check if a query is conversational (greeting, help, capability question).
   * These should be handled without RAG retrieval.
   */
  private isConversationalQuery(query: string): boolean {
    const trimmed = query.trim();
    return GREETING_PATTERNS.test(trimmed) || HELP_PATTERNS.test(trimmed);
  }

  /**
   * Execute a RAG query and return the complete response.
   */
  async query(request: RAGRequest): Promise<RAGResponse> {
    const startTime = Date.now();

    // 0. Check for conversational queries (greetings, help) - skip retrieval
    if (this.isConversationalQuery(request.query)) {
      const response = this.createNoContextResponse(request.query, 0);
      // Log conversational queries too
      await this.logInteraction({
        query: request.query,
        answer: response.answer,
        confidence: 0,
        retrievedChunks: [],
        citations: [],
        sessionId: request.sessionId,
        duration: Date.now() - startTime,
      });
      return response;
    }

    // 1. Check cache for existing response
    const cached = await this.cacheService.get(request.tenantSlug, request.query);
    if (cached) {
      log.info(
        { tenant: request.tenantSlug, event: 'cache_hit' },
        'Returning cached RAG response'
      );
      // Log cache hit for analytics
      await this.logInteraction({
        query: request.query,
        answer: cached.answer,
        confidence: cached.confidence,
        retrievedChunks: [],
        citations: [],
        sessionId: request.sessionId,
        duration: Date.now() - startTime,
        cacheHit: true,
      });
      return cached;
    }

    // 2. Retrieve relevant chunks (track timing)
    const retrievalStart = Date.now();
    const retrieval = await retrieveWithConfig(
      this.db,
      request.query,
      this.llmApiKey,
      this.ragConfig
    );
    const retrievalMs = Date.now() - retrievalStart;

    // 3. Check if we have relevant content
    if (retrieval.chunks.length === 0) {
      const response = this.createNoContextResponse(request.query, retrieval.queryEmbeddingTokens);
      // Log queries with no context found
      await this.logInteraction({
        query: request.query,
        answer: response.answer,
        confidence: 0,
        retrievedChunks: [],
        citations: [],
        sessionId: request.sessionId,
        duration: Date.now() - startTime,
      });
      return response;
    }

    // 4. Rerank chunks for better relevance
    const rankedChunks = rerankChunks(retrieval.chunks, request.query);

    // 5. Check if this is a broad question that benefits from summarization
    const useSummarization = SUMMARIZATION_ENABLED && isBroadQuestion(request.query);
    let summaries: DocumentSummary[] = [];
    let summaryTokens = 0;

    if (useSummarization) {
      log.info({ event: 'using_summarization', query: request.query }, 'Broad question detected, using summarization');
      const summaryResult = await summarizeDocuments(rankedChunks, request.query, this.llmApiKey);
      summaries = summaryResult.summaries;
      summaryTokens = summaryResult.tokensUsed;
    }

    // 6. Build citation context (for citation parsing later)
    const citationContext = buildCitationContext(rankedChunks);

    // 7. Convert to prompt format (use summaries or raw chunks)
    let contexts;
    if (useSummarization && summaries.length > 0) {
      // Use document summaries for broad questions
      contexts = summaries.map((summary) => ({
        chunkId: summary.documentId,
        docId: summary.documentId,
        docTitle: summary.documentTitle,
        content: summary.summary,
        chunkIndex: 0,
        score: summary.confidence,
      }));
    } else {
      // Use raw chunks for specific questions
      contexts = rankedChunks.map((chunk) => ({
        chunkId: chunk.id,
        docId: chunk.document.id,
        docTitle: chunk.document.title,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: chunk.similarity,
      }));
    }

    // 8. Generate response with LLM (track timing)
    const systemPrompt = buildRAGSystemPrompt();
    const userPrompt = buildRAGUserPrompt(request.query, contexts);

    const llmStart = Date.now();
    const llmResponse = await this.llm.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: DEFAULT_RAG_MAX_TOKENS,
        temperature: DEFAULT_RAG_TEMPERATURE,
      }
    );
    const llmMs = Date.now() - llmStart;

    // 9. Parse citations from response
    // For summarization, map document-level citations back to chunks
    const citedResponse = useSummarization
      ? this.parseSummaryCitations(llmResponse.content, summaries, rankedChunks)
      : parseCitations(llmResponse.content, citationContext);
    const overallConfidence = calculateOverallConfidence(citedResponse.citations);

    // 9. Log the Q&A interaction
    await this.logInteraction({
      query: request.query,
      answer: citedResponse.text,
      confidence: overallConfidence,
      retrievedChunks: rankedChunks,
      citations: citedResponse.citations,
      sessionId: request.sessionId,
      duration: Date.now() - startTime,
    });

    const response: RAGResponse = {
      answer: citedResponse.text,
      citations: citedResponse.citations,
      confidence: overallConfidence,
      retrievedChunks: rankedChunks.length,
      tokensUsed: {
        embedding: retrieval.queryEmbeddingTokens,
        completion: llmResponse.usage.totalTokens + summaryTokens,
      },
      timing: {
        retrieval_ms: retrievalMs,
        llm_ms: llmMs,
      },
    };

    // 10. Cache the response for future queries
    await this.cacheService.set(request.tenantSlug, request.query, response);

    return response;
  }

  /**
   * Execute a RAG query with streaming response.
   */
  async queryStream(
    request: RAGRequest,
    callbacks: RAGStreamCallbacks
  ): Promise<void> {
    const startTime = Date.now();
    let fullResponse = '';

    try {
      // 0. Check for conversational queries (greetings, help) - skip retrieval
      if (this.isConversationalQuery(request.query)) {
        const conversationalResponse = this.createNoContextResponse(request.query, 0);
        callbacks.onChunk?.(conversationalResponse.answer);
        // Log conversational queries
        await this.logInteraction({
          query: request.query,
          answer: conversationalResponse.answer,
          confidence: 0,
          retrievedChunks: [],
          citations: [],
          sessionId: request.sessionId,
          duration: Date.now() - startTime,
        });
        callbacks.onComplete?.(conversationalResponse);
        return;
      }

      // 1. Check cache for existing response
      const cached = await this.cacheService.get(request.tenantSlug, request.query);
      if (cached) {
        log.info(
          { tenant: request.tenantSlug, event: 'cache_hit_stream' },
          'Returning cached RAG response (streaming)'
        );
        // Emit cached answer as a single chunk
        callbacks.onChunk?.(cached.answer);
        callbacks.onCitations?.(cached.citations);
        // Log cache hit for analytics
        await this.logInteraction({
          query: request.query,
          answer: cached.answer,
          confidence: cached.confidence,
          retrievedChunks: [],
          citations: [],
          sessionId: request.sessionId,
          duration: Date.now() - startTime,
          cacheHit: true,
        });
        callbacks.onComplete?.(cached);
        return;
      }

      // 2. Retrieve relevant chunks (track timing)
      callbacks.onStatus?.('searching');
      const retrievalStart = Date.now();
      const retrieval = await retrieveWithConfig(
        this.db,
        request.query,
        this.llmApiKey,
        this.ragConfig
      );
      const retrievalMs = Date.now() - retrievalStart;

      // 3. Check if we have relevant content
      if (retrieval.chunks.length === 0) {
        const noContextResponse = this.createNoContextResponse(
          request.query,
          retrieval.queryEmbeddingTokens
        );
        callbacks.onChunk?.(noContextResponse.answer);
        // Log queries with no context
        await this.logInteraction({
          query: request.query,
          answer: noContextResponse.answer,
          confidence: 0,
          retrievedChunks: [],
          citations: [],
          sessionId: request.sessionId,
          duration: Date.now() - startTime,
        });
        callbacks.onComplete?.(noContextResponse);
        return;
      }

      // 4. Rerank and build context
      const rankedChunks = rerankChunks(retrieval.chunks, request.query);
      const citationContext = buildCitationContext(rankedChunks);

      // 5. Convert to prompt format
      const contexts = rankedChunks.map((chunk) => ({
        chunkId: chunk.id,
        docId: chunk.document.id,
        docTitle: chunk.document.title,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: chunk.similarity,
      }));

      // 6. Stream response from LLM (track timing)
      callbacks.onStatus?.('generating');
      const systemPrompt = buildRAGSystemPrompt();
      const userPrompt = buildRAGUserPrompt(request.query, contexts);

      const llmStart = Date.now();
      const stream = this.llm.streamComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        {
          maxTokens: DEFAULT_RAG_MAX_TOKENS,
          temperature: DEFAULT_RAG_TEMPERATURE,
        }
      );

      let completionTokens = 0;

      for await (const chunk of stream) {
        if (chunk.content) {
          fullResponse += chunk.content;
          callbacks.onChunk?.(chunk.content);
        }
        if (chunk.usage) {
          completionTokens = chunk.usage.totalTokens;
        }
      }
      const llmMs = Date.now() - llmStart;

      // 7. Parse citations after streaming completes
      const citedResponse = parseCitations(fullResponse, citationContext);
      const overallConfidence = calculateOverallConfidence(citedResponse.citations);

      // Send citations
      callbacks.onCitations?.(citedResponse.citations);

      // 8. Log interaction
      await this.logInteraction({
        query: request.query,
        answer: fullResponse,
        confidence: overallConfidence,
        retrievedChunks: rankedChunks,
        citations: citedResponse.citations,
        sessionId: request.sessionId,
        duration: Date.now() - startTime,
      });

      // Build response for caching and callback
      const response: RAGResponse = {
        answer: fullResponse,
        citations: citedResponse.citations,
        confidence: overallConfidence,
        retrievedChunks: rankedChunks.length,
        tokensUsed: {
          embedding: retrieval.queryEmbeddingTokens,
          completion: completionTokens,
        },
        timing: {
          retrieval_ms: retrievalMs,
          llm_ms: llmMs,
        },
      };

      // 9. Cache the response for future queries
      await this.cacheService.set(request.tenantSlug, request.query, response);

      // 10. Complete callback
      callbacks.onComplete?.(response);
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Parse citations from summarization response.
   * Maps document-level citations back to chunk-level for consistency.
   */
  private parseSummaryCitations(
    response: string,
    summaries: DocumentSummary[],
    originalChunks: RetrievedChunk[]
  ): CitedResponse {
    const usedCitationNumbers = new Set<number>();
    const citationRegex = /\[Citation\s*(\d+)\]|\[(\d+)\]/gi;

    let match;
    while ((match = citationRegex.exec(response)) !== null) {
      const num = parseInt(match[1] || match[2], 10);
      if (num > 0 && num <= summaries.length) {
        usedCitationNumbers.add(num);
      }
    }

    // Map summary citations to original chunks
    const citations: Citation[] = [];
    const usedChunkIds: string[] = [];

    for (const num of usedCitationNumbers) {
      const summary = summaries[num - 1];
      if (summary) {
        // Find the best chunk from this document
        const docChunks = originalChunks.filter(c => c.document.id === summary.documentId);
        const bestChunk = docChunks[0];

        if (bestChunk) {
          citations.push({
            id: num,
            documentId: summary.documentId,
            documentTitle: summary.documentTitle,
            chunkContent: summary.summary, // Use summary as content
            chunkIndex: 0,
            confidence: summary.confidence,
            source: summary.source,
          });
          usedChunkIds.push(bestChunk.id);
        }
      }
    }

    // Sort citations by their number
    citations.sort((a, b) => a.id - b.id);

    return {
      text: response,
      citations,
      usedChunkIds,
    };
  }

  /**
   * Create a response when no relevant context is found.
   */
  private createNoContextResponse(query: string, embeddingTokens: number): RAGResponse {
    const trimmed = query.trim();
    let answer: string;

    if (GREETING_PATTERNS.test(trimmed)) {
      answer = `Hello! I'm the Q&A assistant for this organization. I can help you find information from our documents and disclosures.

You can ask me questions like:
• What are the key risk factors?
• Summarize the financial performance
• What is the company's growth strategy?
• Who are the board members?

Feel free to ask any question about the company documents!`;
    } else if (HELP_PATTERNS.test(trimmed)) {
      answer = `I'm a document Q&A assistant powered by AI. I can answer questions based on the organization's uploaded documents and disclosures.

Here's how I work:
1. You ask a question about the company
2. I search through the knowledge base to find relevant information
3. I provide an answer with citations to the source documents

Try asking about financial performance, risk factors, company strategy, or any other topic covered in the documents!`;
    } else {
      answer = "I couldn't find relevant information in the knowledge base to answer that question. Try asking about topics covered in the company's documents, such as financial performance, risk factors, or company strategy.";
    }

    return {
      answer,
      citations: [],
      confidence: 0,
      retrievedChunks: 0,
      tokensUsed: {
        embedding: embeddingTokens,
        completion: 0,
      },
      timing: {
        retrieval_ms: 0,
        llm_ms: 0,
      },
    };
  }

  /**
   * Log a Q&A interaction to the tenant database.
   */
  private async logInteraction(params: {
    query: string;
    answer: string;
    confidence: number;
    retrievedChunks: RetrievedChunk[];
    citations: Citation[];
    sessionId?: string;
    duration: number;
    cacheHit?: boolean;
  }): Promise<void> {
    try {
      // Convert to schema Citation format
      const schemaCitations = params.citations.map((c) => ({
        docId: c.documentId,
        title: c.documentTitle,
        chunkId: String(c.id),
        snippet: c.chunkContent.slice(0, 200),
        score: c.confidence,
        chunkIndex: c.chunkIndex,
      }));

      const qaLog: NewQALog = {
        companySlug: this.tenantSlug,
        question: params.query,
        answer: params.answer,
        confidence: params.confidence,
        citations: schemaCitations,
        retrievalScores: params.retrievedChunks.map((c) => c.similarity),
        sessionId: params.sessionId,
        debugInfo: {
          totalMs: params.duration,
          chunksRetrieved: params.retrievedChunks.length,
          cacheHit: params.cacheHit,
        },
      };

      log.info(
        { tenant: this.tenantSlug, questionLength: params.query.length },
        'Attempting to log Q&A interaction'
      );

      await this.db.insert(qaLogs).values(qaLog);

      log.info(
        { tenant: this.tenantSlug },
        'Q&A interaction logged successfully'
      );
    } catch (error) {
      // Don't fail the request if logging fails, but log detailed error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      log.error(
        {
          error: errorMessage,
          stack: errorStack,
          tenant: this.tenantSlug,
          questionLength: params.query.length,
        },
        'Failed to log Q&A interaction to database'
      );
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a RAG service for a tenant.
 */
export function createRAGService(
  db: TenantDatabase,
  llmApiKey: string | null,
  ragConfig: Partial<RAGConfig>,
  tenantSlug: string
): RAGService {
  return new RAGService(db, llmApiKey, ragConfig, tenantSlug);
}
