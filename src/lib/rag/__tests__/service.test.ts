/**
 * Tests for RAG Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('@/lib/llm', () => ({
  createLLMAdapterFromConfig: vi.fn(() => ({
    complete: vi.fn().mockResolvedValue({
      content: 'This is the answer based on the documents. [1]',
      usage: { totalTokens: 150 },
    }),
    streamComplete: vi.fn().mockImplementation(async function* () {
      yield { content: 'This is ' };
      yield { content: 'the answer.' };
      yield { content: ' [1]', usage: { totalTokens: 100 } };
    }),
  })),
  buildRAGSystemPrompt: vi.fn(() => 'You are a helpful assistant.'),
  buildRAGUserPrompt: vi.fn(() => 'Answer this question using the context.'),
}));

vi.mock('../retrieval', () => ({
  retrieveWithConfig: vi.fn(),
  rerankChunks: vi.fn((chunks) => chunks),
}));

vi.mock('../citations', () => ({
  buildCitationContext: vi.fn(() => ({
    chunks: new Map(),
    documents: new Map(),
  })),
  parseCitations: vi.fn((text) => ({
    text,
    citations: [
      {
        id: 1,
        documentId: 'doc-1',
        documentTitle: 'Test Doc',
        chunkContent: 'Test content',
        chunkIndex: 0,
        confidence: 0.85,
        source: null,
      },
    ],
  })),
  calculateOverallConfidence: vi.fn(() => 0.85),
}));

import { RAGService, createRAGService, RAGResponse } from '../service';
import { retrieveWithConfig, rerankChunks } from '../retrieval';
import { parseCitations, calculateOverallConfidence } from '../citations';
import { createLLMAdapterFromConfig } from '@/lib/llm';

// =============================================================================
// Mock Data
// =============================================================================

const mockRetrievedChunks = [
  {
    id: 'chunk-1',
    content: 'First chunk about the topic.',
    chunkIndex: 0,
    similarity: 0.9,
    confidence: 0.85,
    document: { id: 'doc-1', title: 'Test Document', source: null },
  },
  {
    id: 'chunk-2',
    content: 'Second chunk with more details.',
    chunkIndex: 1,
    similarity: 0.8,
    confidence: 0.75,
    document: { id: 'doc-1', title: 'Test Document', source: null },
  },
];

const mockRetrievalResult = {
  chunks: mockRetrievedChunks,
  query: 'test query',
  queryEmbeddingTokens: 10,
};

const createMockDb = () => ({
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
});

// =============================================================================
// RAGService Tests
// =============================================================================

describe('RAGService', () => {
  let service: RAGService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = createMockDb();

    (retrieveWithConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRetrievalResult
    );

    service = new RAGService(
      mockDb as any,
      'sk-test-key',
      { topK: 5, confidenceThreshold: 0.6 },
      'test-tenant'
    );
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    it('should create service with provided config', () => {
      expect(createLLMAdapterFromConfig).toHaveBeenCalledWith('openai', 'sk-test-key');
    });

    it('should use default values for missing config', () => {
      const serviceWithDefaults = new RAGService(
        mockDb as any,
        null,
        {},
        'test-tenant'
      );

      expect(serviceWithDefaults).toBeDefined();
    });
  });

  // ===========================================================================
  // query
  // ===========================================================================

  describe('query', () => {
    it('should execute full RAG pipeline', async () => {
      const result = await service.query({
        query: 'What is machine learning?',
        tenantSlug: 'test-tenant',
      });

      expect(result.answer).toBeDefined();
      expect(result.citations).toHaveLength(1);
      expect(result.confidence).toBe(0.85);
      expect(result.retrievedChunks).toBe(2);
      expect(result.tokensUsed.embedding).toBe(10);
      expect(result.tokensUsed.completion).toBe(150);
    });

    it('should call retrieval with correct parameters', async () => {
      await service.query({
        query: 'test query',
        tenantSlug: 'test-tenant',
      });

      // RAGService now always uses system default values for topK and confidenceThreshold
      // (tenant config is overridden to ensure two-pass retrieval works correctly)
      expect(retrieveWithConfig).toHaveBeenCalledWith(
        mockDb,
        'test query',
        'sk-test-key',
        expect.objectContaining({ topK: 25, confidenceThreshold: 0.25 })
      );
    });

    it('should rerank chunks after retrieval', async () => {
      await service.query({
        query: 'test query',
        tenantSlug: 'test-tenant',
      });

      expect(rerankChunks).toHaveBeenCalledWith(mockRetrievedChunks, 'test query');
    });

    it('should return no-context response when no chunks found', async () => {
      (retrieveWithConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        chunks: [],
        query: 'test query',
        queryEmbeddingTokens: 10,
      });

      const result = await service.query({
        query: 'obscure topic',
        tenantSlug: 'test-tenant',
      });

      expect(result.answer).toContain("couldn't find relevant information");
      expect(result.citations).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(result.retrievedChunks).toBe(0);
    });

    it('should log interaction to database', async () => {
      await service.query({
        query: 'test query',
        tenantSlug: 'test-tenant',
        sessionId: 'session-123',
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'test query',
          sessionId: 'session-123',
        })
      );
    });

    it('should not fail if logging fails', async () => {
      mockDb.values.mockRejectedValueOnce(new Error('DB error'));

      const result = await service.query({
        query: 'test query',
        tenantSlug: 'test-tenant',
      });

      // Should still return response
      expect(result.answer).toBeDefined();
    });
  });

  // ===========================================================================
  // queryStream
  // ===========================================================================

  describe('queryStream', () => {
    it('should stream response chunks', async () => {
      const chunks: string[] = [];
      const callbacks = {
        onChunk: vi.fn((chunk: string) => chunks.push(chunk)),
        onCitations: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      await service.queryStream(
        { query: 'test query', tenantSlug: 'test-tenant' },
        callbacks
      );

      expect(callbacks.onChunk).toHaveBeenCalled();
      expect(chunks.join('')).toContain('This is');
    });

    it('should call onCitations callback', async () => {
      const callbacks = {
        onChunk: vi.fn(),
        onCitations: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      await service.queryStream(
        { query: 'test query', tenantSlug: 'test-tenant' },
        callbacks
      );

      expect(callbacks.onCitations).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ documentId: 'doc-1' }),
        ])
      );
    });

    it('should call onComplete with full response', async () => {
      const callbacks = {
        onChunk: vi.fn(),
        onCitations: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      };

      await service.queryStream(
        { query: 'test query', tenantSlug: 'test-tenant' },
        callbacks
      );

      expect(callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: expect.any(String),
          citations: expect.any(Array),
          confidence: expect.any(Number),
          retrievedChunks: expect.any(Number),
          tokensUsed: expect.objectContaining({
            embedding: expect.any(Number),
            completion: expect.any(Number),
          }),
        })
      );
    });

    it('should handle no-context response in streaming', async () => {
      (retrieveWithConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        chunks: [],
        query: 'test query',
        queryEmbeddingTokens: 10,
      });

      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      };

      await service.queryStream(
        { query: 'obscure topic', tenantSlug: 'test-tenant' },
        callbacks
      );

      expect(callbacks.onChunk).toHaveBeenCalledWith(
        expect.stringContaining("couldn't find relevant information")
      );
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: 0,
          retrievedChunks: 0,
        })
      );
    });

    it('should call onError on exception', async () => {
      (retrieveWithConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Retrieval failed')
      );

      const callbacks = {
        onChunk: vi.fn(),
        onError: vi.fn(),
      };

      await service.queryStream(
        { query: 'test query', tenantSlug: 'test-tenant' },
        callbacks
      );

      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Retrieval failed' })
      );
    });

    it('should log interaction after streaming completes', async () => {
      const callbacks = {
        onComplete: vi.fn(),
      };

      await service.queryStream(
        { query: 'test query', tenantSlug: 'test-tenant', sessionId: 'sess-1' },
        callbacks
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// createRAGService Tests
// =============================================================================

describe('createRAGService', () => {
  it('should create RAGService instance', () => {
    const db = createMockDb();
    const service = createRAGService(
      db as any,
      'sk-test-key',
      { topK: 5 },
      'test-tenant'
    );

    expect(service).toBeInstanceOf(RAGService);
  });

  it('should create service with null API key', () => {
    const db = createMockDb();
    const service = createRAGService(db as any, null, {}, 'test-tenant');

    expect(service).toBeInstanceOf(RAGService);
    expect(createLLMAdapterFromConfig).toHaveBeenCalledWith('openai', null);
  });

  it('should create service with partial RAG config', () => {
    const db = createMockDb();
    const service = createRAGService(
      db as any,
      'sk-key',
      { topK: 10 },
      'test-tenant'
    );

    expect(service).toBeInstanceOf(RAGService);
  });
});

// =============================================================================
// Integration-like Tests
// =============================================================================

describe('RAGService Integration', () => {
  it('should handle complete Q&A flow', async () => {
    const db = createMockDb();
    const service = new RAGService(db as any, 'sk-key', {}, 'test-tenant');

    const result = await service.query({
      query: 'What are the benefits?',
      tenantSlug: 'test-tenant',
      sessionId: 'session-456',
    });

    // Verify the complete flow
    expect(retrieveWithConfig).toHaveBeenCalled();
    expect(rerankChunks).toHaveBeenCalled();
    expect(parseCitations).toHaveBeenCalled();
    expect(calculateOverallConfidence).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();

    // Verify response structure
    expect(result).toMatchObject({
      answer: expect.any(String),
      citations: expect.any(Array),
      confidence: expect.any(Number),
      retrievedChunks: expect.any(Number),
      tokensUsed: {
        embedding: expect.any(Number),
        completion: expect.any(Number),
      },
    });
  });

  it('should track timing in debug info', async () => {
    const db = createMockDb();
    const service = new RAGService(db as any, 'sk-key', {}, 'test-tenant');

    await service.query({
      query: 'test query',
      tenantSlug: 'test-tenant',
    });

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        debugInfo: expect.objectContaining({
          totalMs: expect.any(Number),
          chunksRetrieved: expect.any(Number),
        }),
      })
    );
  });
});
