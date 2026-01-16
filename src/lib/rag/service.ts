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
  buildCitationContext,
  parseCitations,
  calculateOverallConfidence,
  Citation,
} from './citations';

// Create a child logger for RAG service
const log = logger.child({ layer: 'rag', service: 'RAGService' });

// Conversational query patterns (greetings and help requests)
const GREETING_PATTERNS = /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings|what's up|sup)[\s!?.]*$/i;
const HELP_PATTERNS = /^(help|what can you do|how can you help|what are you|who are you|how does this work|what is this)[\s!?.]*$/i;

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

export interface RAGStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onComplete?: (response: RAGResponse) => void;
  onError?: (error: Error) => void;
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
    this.ragConfig = {
      topK: ragConfig.topK ?? 5,
      confidenceThreshold: ragConfig.confidenceThreshold ?? 0.6,
      chunkSize: ragConfig.chunkSize ?? 500,
      chunkOverlap: ragConfig.chunkOverlap ?? 50,
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

    // 5. Build citation context
    const citationContext = buildCitationContext(rankedChunks);

    // 6. Convert to prompt format
    const contexts = rankedChunks.map((chunk) => ({
      chunkId: chunk.id,
      docId: chunk.document.id,
      docTitle: chunk.document.title,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      score: chunk.similarity,
    }));

    // 7. Generate response with LLM (track timing)
    const systemPrompt = buildRAGSystemPrompt();
    const userPrompt = buildRAGUserPrompt(request.query, contexts);

    const llmStart = Date.now();
    const llmResponse = await this.llm.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: 1024,
        temperature: 0.3,
      }
    );
    const llmMs = Date.now() - llmStart;

    // 8. Parse citations from response
    const citedResponse = parseCitations(llmResponse.content, citationContext);
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
        completion: llmResponse.usage.totalTokens,
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
      const systemPrompt = buildRAGSystemPrompt();
      const userPrompt = buildRAGUserPrompt(request.query, contexts);

      const llmStart = Date.now();
      const stream = this.llm.streamComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        {
          maxTokens: 1024,
          temperature: 0.3,
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
