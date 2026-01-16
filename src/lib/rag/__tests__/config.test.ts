/**
 * Tests for RAG Configuration Constants
 *
 * Verifies default values, environment variable parsing, and
 * ensures schema defaults stay in sync with config values.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// =============================================================================
// Default Values Tests
// =============================================================================

describe('RAG Config Default Values', () => {
  // Re-import module fresh for each test to test env var parsing
  let config: typeof import('../config');

  beforeEach(async () => {
    vi.resetModules();
    config = await import('../config');
  });

  describe('retrieval configuration', () => {
    it('should have correct DEFAULT_TOP_K', () => {
      expect(config.DEFAULT_TOP_K).toBe(5);
    });

    it('should have correct DEFAULT_CONFIDENCE_THRESHOLD', () => {
      expect(config.DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.5);
    });

    it('should have correct RRF_K constant', () => {
      expect(config.RRF_K).toBe(60);
    });
  });

  describe('confidence scoring configuration', () => {
    it('should have correct rank thresholds', () => {
      expect(config.CONFIDENCE_RANK_HIGH_THRESHOLD).toBe(3);
      expect(config.CONFIDENCE_RANK_MEDIUM_THRESHOLD).toBe(10);
    });

    it('should have correct confidence scores', () => {
      expect(config.CONFIDENCE_SCORE_HIGH).toBe(0.8);
      expect(config.CONFIDENCE_SCORE_MEDIUM).toBe(0.6);
      expect(config.CONFIDENCE_SCORE_LOW).toBe(0.4);
    });

    it('should have correct keyword boost values', () => {
      expect(config.KEYWORD_RANK_HIGH_THRESHOLD).toBe(3);
      expect(config.KEYWORD_BOOST_HIGH).toBe(0.15);
      expect(config.KEYWORD_BOOST_LOW).toBe(0.05);
    });
  });

  describe('similarity-to-confidence mapping', () => {
    it('should have correct similarity tier thresholds', () => {
      expect(config.SIMILARITY_TIER_VERY_HIGH).toBe(0.9);
      expect(config.SIMILARITY_TIER_HIGH).toBe(0.8);
      expect(config.SIMILARITY_TIER_MEDIUM).toBe(0.7);
    });

    it('should have correct confidence bases and multipliers', () => {
      expect(config.SIMILARITY_CONFIDENCE_VERY_HIGH_BASE).toBe(0.95);
      expect(config.SIMILARITY_CONFIDENCE_VERY_HIGH_MULT).toBe(0.5);
      expect(config.SIMILARITY_CONFIDENCE_HIGH_BASE).toBe(0.85);
      expect(config.SIMILARITY_CONFIDENCE_HIGH_MULT).toBe(1.0);
      expect(config.SIMILARITY_CONFIDENCE_MEDIUM_BASE).toBe(0.70);
      expect(config.SIMILARITY_CONFIDENCE_MEDIUM_MULT).toBe(1.5);
      expect(config.SIMILARITY_CONFIDENCE_LOW_MULT).toBe(0.9);
    });

    it('should have correct confidence label thresholds', () => {
      expect(config.CONFIDENCE_LABEL_HIGH_THRESHOLD).toBe(0.8);
      expect(config.CONFIDENCE_LABEL_MEDIUM_THRESHOLD).toBe(0.6);
    });
  });

  describe('reranking configuration', () => {
    it('should have correct rerank boost values', () => {
      expect(config.RERANK_TERM_BOOST).toBe(0.02);
      expect(config.RERANK_FIRST_CHUNK_BOOST).toBe(0.01);
      expect(config.RERANK_MIN_TERM_LENGTH).toBe(2);
    });
  });

  describe('chunking configuration', () => {
    it('should have correct DEFAULT_CHUNK_SIZE', () => {
      expect(config.DEFAULT_CHUNK_SIZE).toBe(500);
    });

    it('should have correct DEFAULT_CHUNK_OVERLAP', () => {
      expect(config.DEFAULT_CHUNK_OVERLAP).toBe(50);
    });
  });

  describe('LLM configuration', () => {
    it('should have correct DEFAULT_RAG_MAX_TOKENS', () => {
      expect(config.DEFAULT_RAG_MAX_TOKENS).toBe(1024);
    });

    it('should have correct DEFAULT_RAG_TEMPERATURE', () => {
      expect(config.DEFAULT_RAG_TEMPERATURE).toBe(0.3);
    });

    it('should have correct HYDE_MAX_TOKENS', () => {
      expect(config.HYDE_MAX_TOKENS).toBe(150);
    });

    it('should have correct HYDE_TEMPERATURE', () => {
      expect(config.HYDE_TEMPERATURE).toBe(0.3);
    });

    it('should have correct KEYWORD_EXTRACTION_MAX_TOKENS', () => {
      expect(config.KEYWORD_EXTRACTION_MAX_TOKENS).toBe(50);
    });

    it('should have correct KEYWORD_EXTRACTION_TEMPERATURE', () => {
      expect(config.KEYWORD_EXTRACTION_TEMPERATURE).toBe(0.2);
    });

    it('should default HYDE_MODEL to gpt-4o-mini', () => {
      expect(config.HYDE_MODEL).toBe('gpt-4o-mini');
    });
  });

  describe('DEFAULT_RAG_CONFIG composite object', () => {
    it('should contain all required fields', () => {
      expect(config.DEFAULT_RAG_CONFIG).toHaveProperty('topK');
      expect(config.DEFAULT_RAG_CONFIG).toHaveProperty('confidenceThreshold');
      expect(config.DEFAULT_RAG_CONFIG).toHaveProperty('chunkSize');
      expect(config.DEFAULT_RAG_CONFIG).toHaveProperty('chunkOverlap');
    });

    it('should have correct values from individual constants', () => {
      expect(config.DEFAULT_RAG_CONFIG.topK).toBe(config.DEFAULT_TOP_K);
      expect(config.DEFAULT_RAG_CONFIG.confidenceThreshold).toBe(config.DEFAULT_CONFIDENCE_THRESHOLD);
      expect(config.DEFAULT_RAG_CONFIG.chunkSize).toBe(config.DEFAULT_CHUNK_SIZE);
      expect(config.DEFAULT_RAG_CONFIG.chunkOverlap).toBe(config.DEFAULT_CHUNK_OVERLAP);
    });
  });

  describe('conversational patterns', () => {
    it('should match greeting patterns', () => {
      const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'howdy', 'sup'];
      for (const greeting of greetings) {
        expect(config.GREETING_PATTERNS.test(greeting)).toBe(true);
        expect(config.GREETING_PATTERNS.test(`${greeting}!`)).toBe(true);
        expect(config.GREETING_PATTERNS.test(`${greeting}?`)).toBe(true);
      }
    });

    it('should not match non-greeting queries', () => {
      const nonGreetings = ['hello world', 'what is the revenue', 'hi there how are you'];
      for (const query of nonGreetings) {
        expect(config.GREETING_PATTERNS.test(query)).toBe(false);
      }
    });

    it('should match help patterns', () => {
      const helpQueries = ['help', 'what can you do', 'how can you help', 'what are you', 'who are you'];
      for (const query of helpQueries) {
        expect(config.HELP_PATTERNS.test(query)).toBe(true);
      }
    });

    it('should not match non-help queries', () => {
      const nonHelp = ['help me with revenue', 'what can you tell me about profits'];
      for (const query of nonHelp) {
        expect(config.HELP_PATTERNS.test(query)).toBe(false);
      }
    });
  });
});

// =============================================================================
// Environment Variable Parsing Tests
// =============================================================================

describe('Environment Variable Parsing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('HYDE_ENABLED', () => {
    it('should be true by default', async () => {
      delete process.env.HYDE_ENABLED;
      const config = await import('../config');
      expect(config.HYDE_ENABLED).toBe(true);
    });

    it('should be false when set to "false"', async () => {
      process.env.HYDE_ENABLED = 'false';
      const config = await import('../config');
      expect(config.HYDE_ENABLED).toBe(false);
    });

    it('should be true for any other value', async () => {
      process.env.HYDE_ENABLED = 'true';
      const config = await import('../config');
      expect(config.HYDE_ENABLED).toBe(true);
    });
  });

  describe('KEYWORD_EXTRACTION_ENABLED', () => {
    it('should be true by default', async () => {
      delete process.env.KEYWORD_EXTRACTION_ENABLED;
      const config = await import('../config');
      expect(config.KEYWORD_EXTRACTION_ENABLED).toBe(true);
    });

    it('should be false when set to "false"', async () => {
      process.env.KEYWORD_EXTRACTION_ENABLED = 'false';
      const config = await import('../config');
      expect(config.KEYWORD_EXTRACTION_ENABLED).toBe(false);
    });
  });

  describe('RETRIEVAL_DEBUG', () => {
    it('should be false by default', async () => {
      delete process.env.RETRIEVAL_DEBUG;
      const config = await import('../config');
      expect(config.RETRIEVAL_DEBUG).toBe(false);
    });

    it('should be true when set to "true"', async () => {
      process.env.RETRIEVAL_DEBUG = 'true';
      const config = await import('../config');
      expect(config.RETRIEVAL_DEBUG).toBe(true);
    });

    it('should be false for any other value', async () => {
      process.env.RETRIEVAL_DEBUG = 'yes';
      const config = await import('../config');
      expect(config.RETRIEVAL_DEBUG).toBe(false);
    });
  });

  describe('HYDE_MODEL', () => {
    it('should default to gpt-4o-mini', async () => {
      delete process.env.HYDE_MODEL;
      const config = await import('../config');
      expect(config.HYDE_MODEL).toBe('gpt-4o-mini');
    });

    it('should use custom model when set', async () => {
      process.env.HYDE_MODEL = 'gpt-4-turbo';
      const config = await import('../config');
      expect(config.HYDE_MODEL).toBe('gpt-4-turbo');
    });
  });
});

// =============================================================================
// Schema Sync Verification Tests
// =============================================================================

describe('Schema Default Values Sync', () => {
  /**
   * CRITICAL: These tests ensure that the schema defaults in main.ts
   * stay in sync with the authoritative values in config.ts.
   *
   * If these tests fail, update the SCHEMA_DEFAULT_* values in
   * src/db/schema/main.ts to match the values in config.ts.
   */

  it('should have matching DEFAULT_TOP_K', async () => {
    const config = await import('../config');
    const { DEFAULT_RAG_CONFIG } = await import('@/db/schema/main');

    expect(DEFAULT_RAG_CONFIG.topK).toBe(config.DEFAULT_TOP_K);
  });

  it('should have matching DEFAULT_CONFIDENCE_THRESHOLD', async () => {
    const config = await import('../config');
    const { DEFAULT_RAG_CONFIG } = await import('@/db/schema/main');

    expect(DEFAULT_RAG_CONFIG.confidenceThreshold).toBe(config.DEFAULT_CONFIDENCE_THRESHOLD);
  });

  it('should have matching DEFAULT_CHUNK_SIZE', async () => {
    const config = await import('../config');
    const { DEFAULT_RAG_CONFIG } = await import('@/db/schema/main');

    expect(DEFAULT_RAG_CONFIG.chunkSize).toBe(config.DEFAULT_CHUNK_SIZE);
  });

  it('should have matching DEFAULT_CHUNK_OVERLAP', async () => {
    const config = await import('../config');
    const { DEFAULT_RAG_CONFIG } = await import('@/db/schema/main');

    expect(DEFAULT_RAG_CONFIG.chunkOverlap).toBe(config.DEFAULT_CHUNK_OVERLAP);
  });

  it('should have all schema defaults matching config values', async () => {
    const config = await import('../config');
    const { DEFAULT_RAG_CONFIG } = await import('@/db/schema/main');

    // This is a comprehensive check that will fail if any value drifts
    expect(DEFAULT_RAG_CONFIG).toEqual({
      topK: config.DEFAULT_TOP_K,
      confidenceThreshold: config.DEFAULT_CONFIDENCE_THRESHOLD,
      chunkSize: config.DEFAULT_CHUNK_SIZE,
      chunkOverlap: config.DEFAULT_CHUNK_OVERLAP,
    });
  });
});
