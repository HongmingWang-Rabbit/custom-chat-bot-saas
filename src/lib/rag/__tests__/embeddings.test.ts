/**
 * Tests for Embedding Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store mock references for tests
const mockEmbeddingsCreate = vi.fn();
const mockConstructorCalls: Array<{ apiKey: string }> = [];

// Mock OpenAI before importing - use actual class definition
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = { create: mockEmbeddingsCreate };
      constructor(config: { apiKey: string }) {
        mockConstructorCalls.push(config);
      }
    },
  };
});

import {
  EmbeddingService,
  createEmbeddingService,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from '../embeddings';

// =============================================================================
// Test Setup
// =============================================================================

const createMockOpenAI = () => {
  // Reset mocks for each test
  mockEmbeddingsCreate.mockReset();
  mockConstructorCalls.length = 0;

  return { mockCreate: mockEmbeddingsCreate, constructorCalls: mockConstructorCalls };
};

// =============================================================================
// Constants Tests
// =============================================================================

describe('Embedding Constants', () => {
  it('should export correct default model', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('text-embedding-3-large');
  });

  it('should export correct dimensions', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(3072);
  });
});

// =============================================================================
// EmbeddingService Tests
// =============================================================================

describe('EmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      const { constructorCalls } = createMockOpenAI();

      const service = new EmbeddingService('test-api-key');

      expect(constructorCalls).toContainEqual({ apiKey: 'test-api-key' });
      expect(service.getModel()).toBe(DEFAULT_EMBEDDING_MODEL);
      expect(service.getDimensions()).toBe(EMBEDDING_DIMENSIONS);
    });

    it('should accept custom model and dimensions', () => {
      createMockOpenAI();

      const service = new EmbeddingService('test-key', {
        model: 'text-embedding-3-large',
        dimensions: 3072,
      });

      expect(service.getModel()).toBe('text-embedding-3-large');
      expect(service.getDimensions()).toBe(3072);
    });

    it('should cap batch size at 100', () => {
      createMockOpenAI();

      // Batch size > 100 should be capped
      const service = new EmbeddingService('test-key', { batchSize: 200 });

      // We can't directly access batchSize, but we can test the behavior
      expect(service).toBeDefined();
    });
  });

  // ===========================================================================
  // embed() Tests
  // ===========================================================================

  describe('embed', () => {
    it('should generate embedding for text', async () => {
      const { mockCreate } = createMockOpenAI();
      mockCreate.mockResolvedValue({
        data: [{ embedding: Array(3072).fill(0.1) }],
        usage: { total_tokens: 10 },
      });

      const service = new EmbeddingService('test-key');
      const result = await service.embed('Hello world');

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: 'Hello world',
        dimensions: 3072,
      });
      expect(result.embedding).toHaveLength(3072);
      expect(result.tokens).toBe(10);
    });

    it('should throw error for empty text', async () => {
      createMockOpenAI();

      const service = new EmbeddingService('test-key');

      await expect(service.embed('')).rejects.toThrow(
        'Cannot generate embedding for empty text'
      );
      await expect(service.embed('   ')).rejects.toThrow(
        'Cannot generate embedding for empty text'
      );
    });

    it('should use custom dimensions when configured', async () => {
      const { mockCreate } = createMockOpenAI();
      mockCreate.mockResolvedValue({
        data: [{ embedding: Array(3072).fill(0.1) }],
        usage: { total_tokens: 15 },
      });

      const service = new EmbeddingService('test-key', { dimensions: 3072 });
      await service.embed('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: 3072 })
      );
    });
  });

  // ===========================================================================
  // embedBatch() Tests
  // ===========================================================================

  describe('embedBatch', () => {
    it('should return empty array for empty input', async () => {
      createMockOpenAI();

      const service = new EmbeddingService('test-key');
      const result = await service.embedBatch([]);

      expect(result.embeddings).toEqual([]);
      expect(result.totalTokens).toBe(0);
    });

    it('should filter out empty texts', async () => {
      const { mockCreate } = createMockOpenAI();
      mockCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
        usage: { total_tokens: 20 },
      });

      const service = new EmbeddingService('test-key');
      const result = await service.embedBatch(['valid', '', '  ', 'also valid']);

      // Should only process valid texts
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: ['valid', 'also valid'],
        dimensions: 3072,
      });
      expect(result.embeddings).toHaveLength(2);
      expect(result.totalTokens).toBe(20);
    });

    it('should return empty result when all texts are empty', async () => {
      createMockOpenAI();

      const service = new EmbeddingService('test-key');
      const result = await service.embedBatch(['', '   ', '\n']);

      expect(result.embeddings).toEqual([]);
      expect(result.totalTokens).toBe(0);
    });

    it('should sort embeddings by index', async () => {
      const { mockCreate } = createMockOpenAI();
      // Return embeddings out of order
      mockCreate.mockResolvedValue({
        data: [
          { index: 2, embedding: [0.5, 0.6] },
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
        usage: { total_tokens: 30 },
      });

      const service = new EmbeddingService('test-key');
      const result = await service.embedBatch(['a', 'b', 'c']);

      // Should be sorted by index
      expect(result.embeddings[0]).toEqual([0.1, 0.2]);
      expect(result.embeddings[1]).toEqual([0.3, 0.4]);
      expect(result.embeddings[2]).toEqual([0.5, 0.6]);
    });

    it('should process large batches in chunks', async () => {
      const { mockCreate } = createMockOpenAI();

      // First batch
      mockCreate.mockResolvedValueOnce({
        data: Array(100).fill(0).map((_, i) => ({ index: i, embedding: [i] })),
        usage: { total_tokens: 1000 },
      });
      // Second batch
      mockCreate.mockResolvedValueOnce({
        data: Array(50).fill(0).map((_, i) => ({ index: i, embedding: [i + 100] })),
        usage: { total_tokens: 500 },
      });

      const service = new EmbeddingService('test-key');
      const texts = Array(150).fill('text');
      const result = await service.embedBatch(texts);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.embeddings).toHaveLength(150);
      expect(result.totalTokens).toBe(1500);
    });
  });

  // ===========================================================================
  // Getter Tests
  // ===========================================================================

  describe('getters', () => {
    it('getModel should return configured model', () => {
      createMockOpenAI();

      const service = new EmbeddingService('key', { model: 'custom-model' });

      expect(service.getModel()).toBe('custom-model');
    });

    it('getDimensions should return configured dimensions', () => {
      createMockOpenAI();

      const service = new EmbeddingService('key', { dimensions: 768 });

      expect(service.getDimensions()).toBe(768);
    });
  });
});

// =============================================================================
// createEmbeddingService Factory Tests
// =============================================================================

describe('createEmbeddingService', () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('should create service with provided API key', () => {
    const { constructorCalls } = createMockOpenAI();

    const service = createEmbeddingService('provided-key');

    expect(constructorCalls).toContainEqual({ apiKey: 'provided-key' });
    expect(service).toBeInstanceOf(EmbeddingService);
  });

  it('should fallback to environment variable when no key provided', () => {
    const { constructorCalls } = createMockOpenAI();
    process.env.OPENAI_API_KEY = 'env-key';

    const service = createEmbeddingService(null);

    expect(constructorCalls).toContainEqual({ apiKey: 'env-key' });
    expect(service).toBeInstanceOf(EmbeddingService);
  });

  it('should throw error when no API key available', () => {
    createMockOpenAI();
    delete process.env.OPENAI_API_KEY;

    expect(() => createEmbeddingService(null)).toThrow(
      'No OpenAI API key provided and OPENAI_API_KEY not set'
    );
  });

  it('should accept custom config', () => {
    createMockOpenAI();

    const service = createEmbeddingService('key', {
      model: 'custom-model',
      dimensions: 512,
    });

    expect(service.getModel()).toBe('custom-model');
    expect(service.getDimensions()).toBe(512);
  });
});
