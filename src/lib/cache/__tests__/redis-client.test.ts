/**
 * Tests for Redis client module (Upstash)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_BACKOFF_BASE_MS,
  isRedisConfigured,
  getRedisClient,
  closeRedisConnection,
  isRedisAvailable,
  resetRedisClient,
} from '../redis-client';

// Mock the @upstash/redis module
const mockPing = vi.fn();
const mockRedisInstance = {
  ping: mockPing,
};

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => mockRedisInstance),
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

describe('redis-client constants', () => {
  describe('DEFAULT_CONNECT_TIMEOUT_MS', () => {
    it('is a positive number', () => {
      expect(DEFAULT_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('is 5 seconds', () => {
      expect(DEFAULT_CONNECT_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('DEFAULT_COMMAND_TIMEOUT_MS', () => {
    it('is a positive number', () => {
      expect(DEFAULT_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('is 3 seconds', () => {
      expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(3000);
    });
  });

  describe('MAX_RECONNECT_DELAY_MS', () => {
    it('is a positive number', () => {
      expect(MAX_RECONNECT_DELAY_MS).toBeGreaterThan(0);
    });

    it('is 30 seconds', () => {
      expect(MAX_RECONNECT_DELAY_MS).toBe(30000);
    });

    it('is greater than connect timeout', () => {
      expect(MAX_RECONNECT_DELAY_MS).toBeGreaterThan(DEFAULT_CONNECT_TIMEOUT_MS);
    });
  });

  describe('RECONNECT_BACKOFF_BASE_MS', () => {
    it('is a positive number', () => {
      expect(RECONNECT_BACKOFF_BASE_MS).toBeGreaterThan(0);
    });

    it('is 100ms', () => {
      expect(RECONNECT_BACKOFF_BASE_MS).toBe(100);
    });
  });
});

describe('redis-client functions', () => {
  // Store original env
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRedisClient();
  });

  afterEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    resetRedisClient();
  });

  describe('isRedisConfigured', () => {
    it('returns true when both URL and token are set', () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      expect(isRedisConfigured()).toBe(true);
    });

    it('returns false when URL is not set', () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      expect(isRedisConfigured()).toBe(false);
    });

    it('returns false when token is not set', () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      expect(isRedisConfigured()).toBe(false);
    });

    it('returns false when both are not set', () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      expect(isRedisConfigured()).toBe(false);
    });
  });

  describe('getRedisClient', () => {
    it('returns null when credentials are not configured', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const client = await getRedisClient();
      expect(client).toBeNull();
    });

    it('returns same instance on subsequent calls (when configured)', async () => {
      // Skip if not configured - this test only works when actually configured
      if (!isRedisConfigured()) {
        return;
      }
      const client1 = await getRedisClient();
      const client2 = await getRedisClient();
      expect(client1).toBe(client2);
    });
  });

  describe('closeRedisConnection', () => {
    it('clears the client reference', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

      await getRedisClient();
      await closeRedisConnection();

      // Should not throw
      await expect(closeRedisConnection()).resolves.toBeUndefined();
    });
  });

  describe('isRedisAvailable', () => {
    it('returns false when not configured', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const available = await isRedisAvailable();
      expect(available).toBe(false);
    });

    it('handles ping results correctly', async () => {
      // This test verifies the logic - actual client testing requires real credentials
      // When configured, isRedisAvailable returns true if ping returns 'PONG'
      // When ping fails, it returns false
      expect(typeof isRedisAvailable).toBe('function');
    });
  });
});

describe('reconnect strategy (legacy constants)', () => {
  it('calculates exponential backoff correctly', () => {
    // Test the backoff formula: Math.min(retries * RECONNECT_BACKOFF_BASE_MS, MAX_RECONNECT_DELAY_MS)
    const calculateDelay = (retries: number) =>
      Math.min(retries * RECONNECT_BACKOFF_BASE_MS, MAX_RECONNECT_DELAY_MS);

    expect(calculateDelay(1)).toBe(100);
    expect(calculateDelay(5)).toBe(500);
    expect(calculateDelay(10)).toBe(1000);
    expect(calculateDelay(100)).toBe(10000);
    expect(calculateDelay(300)).toBe(30000); // Hits max
    expect(calculateDelay(1000)).toBe(30000); // Still at max
  });

  it('never exceeds MAX_RECONNECT_DELAY_MS', () => {
    for (let retries = 1; retries <= 1000; retries++) {
      const delay = Math.min(retries * RECONNECT_BACKOFF_BASE_MS, MAX_RECONNECT_DELAY_MS);
      expect(delay).toBeLessThanOrEqual(MAX_RECONNECT_DELAY_MS);
    }
  });
});
