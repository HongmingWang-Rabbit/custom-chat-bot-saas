/**
 * Tests for RAG cache service (Upstash)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RAGCacheService,
  getRAGCacheService,
  resetRAGCacheService,
  CACHE_VERSION,
  type CacheableRAGResponse,
} from '../rag-cache';

// Mock Redis client with Upstash API
vi.mock('../redis-client', () => {
  // Store data as objects (Upstash auto-serializes)
  let mockStore: Map<string, unknown> = new Map();

  return {
    isRedisConfigured: vi.fn(() => true),
    getRedisClient: vi.fn(async () => ({
      // Upstash get returns deserialized JSON directly
      get: vi.fn(async (key: string) => mockStore.get(key) ?? null),
      // Upstash set with options { ex: ttl }
      set: vi.fn(async (key: string, value: unknown, _options?: { ex?: number }) => {
        mockStore.set(key, value);
        return 'OK';
      }),
      // Upstash del accepts spread args
      del: vi.fn(async (...keys: string[]) => {
        keys.forEach((k) => mockStore.delete(k));
        return keys.length;
      }),
      // Upstash scan returns [cursor, keys] tuple
      scan: vi.fn(async (cursor: number, options: { match: string; count: number }) => {
        const pattern = options.match.replace('*', '');
        const matchingKeys = Array.from(mockStore.keys()).filter((k) =>
          (k as string).startsWith(pattern)
        );
        return [0, matchingKeys]; // cursor 0 means done
      }),
    })),
    __mockStore: mockStore,
    __clearMockStore: () => {
      mockStore.clear();
    },
  };
});

// Sample response for testing
const sampleResponse: CacheableRAGResponse = {
  answer: 'AI stands for Artificial Intelligence.',
  citations: [
    {
      id: 1,
      documentId: 'doc-1',
      documentTitle: 'AI Overview',
      chunkContent: 'Artificial Intelligence (AI) is...',
      chunkIndex: 0,
      confidence: 0.95,
      source: null,
    },
  ],
  confidence: 0.95,
  retrievedChunks: 3,
  tokensUsed: {
    embedding: 10,
    completion: 50,
  },
  timing: {
    retrieval_ms: 35,
    llm_ms: 520,
  },
};

describe('RAGCacheService', () => {
  let cacheService: RAGCacheService;

  beforeEach(async () => {
    // Clear mock store before each test
    const { __clearMockStore } = await import('../redis-client');
    (
      __clearMockStore as () => void
    )();
    resetRAGCacheService();
    cacheService = new RAGCacheService({ enabled: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('returns true when cache is enabled and Redis configured', () => {
      const service = new RAGCacheService({ enabled: true });
      expect(service.isEnabled()).toBe(true);
    });

    it('returns false when cache is disabled', () => {
      const service = new RAGCacheService({ enabled: false });
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('get', () => {
    it('returns null for cache miss', async () => {
      const result = await cacheService.get('tenant-1', 'What is AI?');
      expect(result).toBeNull();
    });

    it('returns cached response for cache hit', async () => {
      await cacheService.set('tenant-1', 'What is AI?', sampleResponse);
      const result = await cacheService.get('tenant-1', 'What is AI?');

      expect(result).not.toBeNull();
      expect(result?.answer).toBe(sampleResponse.answer);
      expect(result?.citations).toEqual(sampleResponse.citations);
      expect(result?.confidence).toBe(sampleResponse.confidence);
    });

    it('returns same response for normalized equivalent questions', async () => {
      await cacheService.set('tenant-1', 'What is AI?', sampleResponse);

      const result1 = await cacheService.get('tenant-1', 'what is ai');
      const result2 = await cacheService.get('tenant-1', '  WHAT IS AI??  ');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1?.answer).toBe(result2?.answer);
    });

    it('returns null when cache is disabled', async () => {
      const disabledService = new RAGCacheService({ enabled: false });
      await cacheService.set('tenant-1', 'What is AI?', sampleResponse);

      const result = await disabledService.get('tenant-1', 'What is AI?');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores response in cache', async () => {
      await cacheService.set('tenant-1', 'What is AI?', sampleResponse);
      const result = await cacheService.get('tenant-1', 'What is AI?');

      expect(result).not.toBeNull();
      expect(result?.answer).toBe(sampleResponse.answer);
    });

    it('does not store when cache is disabled', async () => {
      const disabledService = new RAGCacheService({ enabled: false });
      await disabledService.set('tenant-1', 'What is AI?', sampleResponse);

      // Use enabled service to check
      const result = await cacheService.get('tenant-1', 'What is AI?');
      expect(result).toBeNull();
    });

    it('isolates cache by tenant', async () => {
      await cacheService.set('tenant-1', 'What is AI?', sampleResponse);

      const result1 = await cacheService.get('tenant-1', 'What is AI?');
      const result2 = await cacheService.get('tenant-2', 'What is AI?');

      expect(result1).not.toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe('invalidateTenant', () => {
    it('removes all cached responses for tenant', async () => {
      await cacheService.set('tenant-1', 'Question 1?', sampleResponse);
      await cacheService.set('tenant-1', 'Question 2?', sampleResponse);
      await cacheService.set('tenant-2', 'Question 1?', sampleResponse);

      const deleted = await cacheService.invalidateTenant('tenant-1');

      expect(deleted).toBe(2);

      // Tenant 1 cache cleared
      expect(await cacheService.get('tenant-1', 'Question 1?')).toBeNull();
      expect(await cacheService.get('tenant-1', 'Question 2?')).toBeNull();

      // Tenant 2 cache preserved
      expect(await cacheService.get('tenant-2', 'Question 1?')).not.toBeNull();
    });

    it('returns 0 when cache is disabled', async () => {
      const disabledService = new RAGCacheService({ enabled: false });
      const deleted = await disabledService.invalidateTenant('tenant-1');
      expect(deleted).toBe(0);
    });

    it('returns 0 when no keys exist', async () => {
      const deleted = await cacheService.invalidateTenant('nonexistent-tenant');
      expect(deleted).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const config = cacheService.getConfig();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('ttlSeconds');
      expect(config).toHaveProperty('keyPrefix');
    });

    it('returns a copy (not reference)', () => {
      const config1 = cacheService.getConfig();
      const config2 = cacheService.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});

describe('getRAGCacheService', () => {
  beforeEach(() => {
    resetRAGCacheService();
  });

  it('returns singleton instance', () => {
    const instance1 = getRAGCacheService();
    const instance2 = getRAGCacheService();
    expect(instance1).toBe(instance2);
  });

  it('creates new instance after reset', () => {
    const instance1 = getRAGCacheService();
    resetRAGCacheService();
    const instance2 = getRAGCacheService();
    expect(instance1).not.toBe(instance2);
  });
});

describe('CACHE_VERSION', () => {
  it('is a valid semver string', () => {
    expect(CACHE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
