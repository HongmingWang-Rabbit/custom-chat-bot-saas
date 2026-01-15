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
import { retrieveWithConfig, RetrievedChunk, rerankChunks } from './retrieval';
import {
  buildCitationContext,
  parseCitations,
  calculateOverallConfidence,
  Citation,
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
  }

  /**
   * Execute a RAG query and return the complete response.
   */
  async query(request: RAGRequest): Promise<RAGResponse> {
    const startTime = Date.now();

    // 1. Retrieve relevant chunks
    const retrieval = await retrieveWithConfig(
      this.db,
      request.query,
      this.llmApiKey,
      this.ragConfig
    );

    // 2. Check if we have relevant content
    if (retrieval.chunks.length === 0) {
      return this.createNoContextResponse(request.query, retrieval.queryEmbeddingTokens);
    }

    // 3. Rerank chunks for better relevance
    const rankedChunks = rerankChunks(retrieval.chunks, request.query);

    // 4. Build citation context
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

    // 6. Generate response with LLM
    const systemPrompt = buildRAGSystemPrompt();
    const userPrompt = buildRAGUserPrompt(request.query, contexts);

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

    // 7. Parse citations from response
    const citedResponse = parseCitations(llmResponse.content, citationContext);
    const overallConfidence = calculateOverallConfidence(citedResponse.citations);

    // 8. Log the Q&A interaction
    await this.logInteraction({
      query: request.query,
      answer: citedResponse.text,
      confidence: overallConfidence,
      retrievedChunks: rankedChunks,
      citations: citedResponse.citations,
      sessionId: request.sessionId,
      duration: Date.now() - startTime,
    });

    return {
      answer: citedResponse.text,
      citations: citedResponse.citations,
      confidence: overallConfidence,
      retrievedChunks: rankedChunks.length,
      tokensUsed: {
        embedding: retrieval.queryEmbeddingTokens,
        completion: llmResponse.usage.totalTokens,
      },
    };
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
      // 1. Retrieve relevant chunks
      const retrieval = await retrieveWithConfig(
        this.db,
        request.query,
        this.llmApiKey,
        this.ragConfig
      );

      // 2. Check if we have relevant content
      if (retrieval.chunks.length === 0) {
        const noContextResponse = this.createNoContextResponse(
          request.query,
          retrieval.queryEmbeddingTokens
        );
        callbacks.onChunk?.(noContextResponse.answer);
        callbacks.onComplete?.(noContextResponse);
        return;
      }

      // 3. Rerank and build context
      const rankedChunks = rerankChunks(retrieval.chunks, request.query);
      const citationContext = buildCitationContext(rankedChunks);

      // 4. Convert to prompt format
      const contexts = rankedChunks.map((chunk) => ({
        chunkId: chunk.id,
        docId: chunk.document.id,
        docTitle: chunk.document.title,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: chunk.similarity,
      }));

      // 5. Stream response from LLM
      const systemPrompt = buildRAGSystemPrompt();
      const userPrompt = buildRAGUserPrompt(request.query, contexts);

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

      // 6. Parse citations after streaming completes
      const citedResponse = parseCitations(fullResponse, citationContext);
      const overallConfidence = calculateOverallConfidence(citedResponse.citations);

      // Send citations
      callbacks.onCitations?.(citedResponse.citations);

      // 7. Log interaction
      await this.logInteraction({
        query: request.query,
        answer: fullResponse,
        confidence: overallConfidence,
        retrievedChunks: rankedChunks,
        citations: citedResponse.citations,
        sessionId: request.sessionId,
        duration: Date.now() - startTime,
      });

      // 8. Complete callback
      callbacks.onComplete?.({
        answer: fullResponse,
        citations: citedResponse.citations,
        confidence: overallConfidence,
        retrievedChunks: rankedChunks.length,
        tokensUsed: {
          embedding: retrieval.queryEmbeddingTokens,
          completion: completionTokens,
        },
      });
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Create a response when no relevant context is found.
   */
  private createNoContextResponse(query: string, embeddingTokens: number): RAGResponse {
    return {
      answer:
        "I don't have enough information in my knowledge base to answer this question confidently. Could you try rephrasing your question or ask about a different topic?",
      citations: [],
      confidence: 0,
      retrievedChunks: 0,
      tokensUsed: {
        embedding: embeddingTokens,
        completion: 0,
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
        question: params.query,
        answer: params.answer,
        confidence: params.confidence,
        citations: schemaCitations,
        retrievalScores: params.retrievedChunks.map((c) => c.similarity),
        sessionId: params.sessionId,
        debugInfo: {
          totalMs: params.duration,
          chunksRetrieved: params.retrievedChunks.length,
        },
      };

      await this.db.insert(qaLogs).values(qaLog);
    } catch (error) {
      // Don't fail the request if logging fails
      log.error(
        { error: error instanceof Error ? error.message : String(error), tenant: this.tenantSlug },
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
