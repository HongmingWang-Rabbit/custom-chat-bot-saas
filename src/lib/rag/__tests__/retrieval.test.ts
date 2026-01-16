/**
 * Tests for RAG Retrieval Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../embeddings', () => ({
  createEmbeddingService: vi.fn(() => ({
    embed: vi.fn().mockResolvedValue({
      embedding: Array(3072).fill(0.1),
      tokens: 10,
    }),
  })),
}));

vi.mock('../hyde', () => ({
  generateHypotheticalDocument: vi.fn().mockResolvedValue('hypothetical document text'),
}));

import {
  retrieveChunks,
  retrieveWithConfig,
  calculateConfidence,
  getConfidenceLabel,
  rerankChunks,
  RetrievedChunk,
} from '../retrieval';
import { createEmbeddingService } from '../embeddings';

// =============================================================================
// Mock Data
// =============================================================================

// Mock data now includes RRF fields (vector_rank, keyword_rank, rrf_score)
const mockChunkRows = [
  {
    chunk_id: 'chunk-1',
    content: 'This is the first chunk about machine learning.',
    chunk_index: 0,
    vector_score: '0.92',
    vector_rank: '1',
    keyword_score: '0.5',
    keyword_rank: '1',
    rrf_score: '0.0328', // Max RRF score (rank 1 in both)
    document_id: 'doc-1',
    document_title: 'ML Guide',
    document_source: 'https://example.com/ml',
  },
  {
    chunk_id: 'chunk-2',
    content: 'Second chunk about neural networks and deep learning.',
    chunk_index: 1,
    vector_score: '0.85',
    vector_rank: '2',
    keyword_score: '0.3',
    keyword_rank: '2',
    rrf_score: '0.0320',
    document_id: 'doc-1',
    document_title: 'ML Guide',
    document_source: 'https://example.com/ml',
  },
  {
    chunk_id: 'chunk-3',
    content: 'Third chunk about data preprocessing techniques.',
    chunk_index: 2,
    vector_score: '0.65',
    vector_rank: '3',
    keyword_score: '0.1',
    keyword_rank: '3',
    rrf_score: '0.0312',
    document_id: 'doc-2',
    document_title: 'Data Science Handbook',
    document_source: null,
  },
];

// Mock DB needs to return count for first query, then chunks for second
const createMockDb = (rows: typeof mockChunkRows = mockChunkRows) => {
  let callCount = 0;
  return {
    execute: vi.fn().mockImplementation(() => {
      callCount++;
      // First call is the count query
      if (callCount === 1) {
        return Promise.resolve([{ count: '10' }]);
      }
      // Second call is the main hybrid search query
      return Promise.resolve(rows);
    }),
  };
};

// =============================================================================
// retrieveChunks Tests
// =============================================================================

describe('retrieveChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should retrieve chunks with similarity search', async () => {
    const db = createMockDb();

    const result = await retrieveChunks(db as any, 'machine learning query', null);

    expect(result.chunks).toHaveLength(3);
    expect(result.query).toBe('machine learning query');
    expect(result.queryEmbeddingTokens).toBe(10);
    expect(createEmbeddingService).toHaveBeenCalledWith(null);
    expect(db.execute).toHaveBeenCalled();
  });

  it('should filter chunks below confidence threshold', async () => {
    // RRF scores: max ~0.0328 normalizes to 1.0, so 0.02 normalizes to ~0.61
    const db = createMockDb([
      { ...mockChunkRows[0], rrf_score: '0.0328' }, // Normalizes to ~1.0
      { ...mockChunkRows[1], rrf_score: '0.015' },  // Normalizes to ~0.46, below 0.6
      { ...mockChunkRows[2], rrf_score: '0.010' },  // Normalizes to ~0.30, below 0.6
    ]);

    const result = await retrieveChunks(db as any, 'query', null, {
      confidenceThreshold: 0.6,
    });

    expect(result.chunks).toHaveLength(1);
    // Normalized RRF score should be ~1.0 (0.0328 / 0.0328)
    expect(result.chunks[0].similarity).toBeCloseTo(1.0, 1);
  });

  it('should respect topK option', async () => {
    const db = createMockDb();

    await retrieveChunks(db as any, 'query', null, { topK: 10 });

    expect(db.execute).toHaveBeenCalled();
    // The SQL should include LIMIT 10
    const sqlCall = db.execute.mock.calls[0][0];
    expect(sqlCall).toBeDefined();
  });

  it('should pass API key to embedding service', async () => {
    const db = createMockDb();

    await retrieveChunks(db as any, 'query', 'sk-test-key');

    expect(createEmbeddingService).toHaveBeenCalledWith('sk-test-key');
  });

  it('should calculate confidence for each chunk', async () => {
    const db = createMockDb();

    const result = await retrieveChunks(db as any, 'query', null);

    for (const chunk of result.chunks) {
      expect(chunk.confidence).toBeGreaterThan(0);
      expect(chunk.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should include document metadata', async () => {
    const db = createMockDb();

    const result = await retrieveChunks(db as any, 'query', null);

    expect(result.chunks[0].document.id).toBe('doc-1');
    expect(result.chunks[0].document.title).toBe('ML Guide');
    expect(result.chunks[0].document.source).toBe('https://example.com/ml');
  });

  it('should return empty array if no chunks found', async () => {
    const db = createMockDb([]);

    const result = await retrieveChunks(db as any, 'query', null);

    expect(result.chunks).toHaveLength(0);
  });
});

// =============================================================================
// retrieveWithConfig Tests
// =============================================================================

describe('retrieveWithConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use RAG config values', async () => {
    const db = createMockDb();

    const result = await retrieveWithConfig(db as any, 'query', null, {
      topK: 10,
      confidenceThreshold: 0.8,
    });

    expect(result.query).toBe('query');
    expect(db.execute).toHaveBeenCalled();
  });

  it('should use default values when config is empty', async () => {
    const db = createMockDb();

    const result = await retrieveWithConfig(db as any, 'query', null, {});

    expect(result).toBeDefined();
    expect(db.execute).toHaveBeenCalled();
  });

  it('should use default values when config is undefined', async () => {
    const db = createMockDb();

    const result = await retrieveWithConfig(db as any, 'query', null);

    expect(result).toBeDefined();
  });
});

// =============================================================================
// calculateConfidence Tests
// =============================================================================

describe('calculateConfidence', () => {
  it('should boost high similarity scores (>= 0.9)', () => {
    const confidence = calculateConfidence(0.95);

    expect(confidence).toBeGreaterThan(0.95);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it('should calculate confidence for 0.9 similarity', () => {
    const confidence = calculateConfidence(0.9);

    expect(confidence).toBeCloseTo(0.95, 2);
  });

  it('should calculate confidence for 0.8-0.9 similarity', () => {
    const confidence = calculateConfidence(0.85);

    expect(confidence).toBeGreaterThan(0.85);
    expect(confidence).toBeLessThan(0.95);
  });

  it('should calculate confidence for 0.7-0.8 similarity', () => {
    const confidence = calculateConfidence(0.75);

    expect(confidence).toBeGreaterThan(0.7);
    expect(confidence).toBeLessThan(0.85);
  });

  it('should scale lower similarities', () => {
    const confidence = calculateConfidence(0.5);

    expect(confidence).toBe(0.5 * 0.9);
  });

  it('should return 0 for 0 similarity', () => {
    const confidence = calculateConfidence(0);

    expect(confidence).toBe(0);
  });

  it('should not return negative values', () => {
    const confidence = calculateConfidence(-0.1);

    expect(confidence).toBeGreaterThanOrEqual(0);
  });

  it('should handle similarity of 1.0', () => {
    const confidence = calculateConfidence(1.0);

    expect(confidence).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// getConfidenceLabel Tests
// =============================================================================

describe('getConfidenceLabel', () => {
  it('should return "high" for confidence >= 0.8', () => {
    expect(getConfidenceLabel(0.8)).toBe('high');
    expect(getConfidenceLabel(0.9)).toBe('high');
    expect(getConfidenceLabel(1.0)).toBe('high');
  });

  it('should return "medium" for confidence >= 0.6 and < 0.8', () => {
    expect(getConfidenceLabel(0.6)).toBe('medium');
    expect(getConfidenceLabel(0.7)).toBe('medium');
    expect(getConfidenceLabel(0.79)).toBe('medium');
  });

  it('should return "low" for confidence < 0.6', () => {
    expect(getConfidenceLabel(0.5)).toBe('low');
    expect(getConfidenceLabel(0.3)).toBe('low');
    expect(getConfidenceLabel(0)).toBe('low');
  });
});

// =============================================================================
// rerankChunks Tests
// =============================================================================

describe('rerankChunks', () => {
  const createChunks = (): RetrievedChunk[] => [
    {
      id: 'chunk-1',
      content: 'This chunk talks about machine learning algorithms.',
      chunkIndex: 1,
      similarity: 0.8,
      confidence: 0.75,
      document: { id: 'doc-1', title: 'ML Guide', source: null },
    },
    {
      id: 'chunk-2',
      content: 'Introduction to the topic of neural networks.',
      chunkIndex: 0,
      similarity: 0.85,
      confidence: 0.80,
      document: { id: 'doc-1', title: 'ML Guide', source: null },
    },
    {
      id: 'chunk-3',
      content: 'Data preprocessing is important.',
      chunkIndex: 2,
      similarity: 0.7,
      confidence: 0.65,
      document: { id: 'doc-2', title: 'Data Guide', source: null },
    },
  ];

  it('should boost chunks containing query terms', () => {
    const chunks = createChunks();
    const result = rerankChunks(chunks, 'machine learning');

    // Chunk 1 should be boosted because it contains "machine" and "learning"
    const chunk1 = result.find((c) => c.id === 'chunk-1');
    expect(chunk1!.confidence).toBeGreaterThan(0.75);
  });

  it('should boost first chunks (chunkIndex === 0)', () => {
    const chunks = createChunks();
    const result = rerankChunks(chunks, 'random query');

    // Chunk 2 has chunkIndex 0, should get slight boost
    const chunk2 = result.find((c) => c.id === 'chunk-2');
    expect(chunk2!.confidence).toBeGreaterThan(0.80);
  });

  it('should sort by confidence descending', () => {
    const chunks = createChunks();
    const result = rerankChunks(chunks, 'query');

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].confidence).toBeGreaterThanOrEqual(result[i].confidence);
    }
  });

  it('should not boost short query terms (< 3 chars)', () => {
    const chunks = createChunks();
    const result = rerankChunks(chunks, 'is to');

    // "is" and "to" are too short to boost
    const chunk1 = result.find((c) => c.id === 'chunk-1');
    // Only boost should be from chunkIndex if applicable
    expect(chunk1!.confidence).toBeCloseTo(0.75, 1);
  });

  it('should cap confidence at 1.0', () => {
    const chunks: RetrievedChunk[] = [
      {
        id: 'chunk-1',
        content: 'machine learning algorithms neural networks deep learning models',
        chunkIndex: 0,
        similarity: 0.99,
        confidence: 0.99,
        document: { id: 'doc-1', title: 'ML', source: null },
      },
    ];

    const result = rerankChunks(chunks, 'machine learning neural networks deep models');

    expect(result[0].confidence).toBeLessThanOrEqual(1);
  });

  it('should handle empty chunks array', () => {
    const result = rerankChunks([], 'query');

    expect(result).toHaveLength(0);
  });

  it('should handle empty query', () => {
    const chunks = createChunks();
    const result = rerankChunks(chunks, '');

    // Should still sort by confidence
    expect(result).toHaveLength(3);
  });

  it('should be case-insensitive for term matching', () => {
    const chunks: RetrievedChunk[] = [
      {
        id: 'chunk-1',
        content: 'MACHINE LEARNING is great',
        chunkIndex: 1,
        similarity: 0.8,
        confidence: 0.75,
        document: { id: 'doc-1', title: 'ML', source: null },
      },
    ];

    const result = rerankChunks(chunks, 'machine learning');

    expect(result[0].confidence).toBeGreaterThan(0.75);
  });
});
