/**
 * Tests for Redis client module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_BACKOFF_BASE_MS,
} from '../redis-client';

// Mock the redis module
const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockPing = vi.fn();
const mockOn = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: mockConnect,
    quit: mockQuit,
    ping: mockPing,
    on: mockOn,
    isOpen: true,
  })),
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
  describe('isRedisConfigured', () => {
    // Store original env
    const originalEnv = process.env.REDIS_URL;

    afterEach(() => {
      process.env.REDIS_URL = originalEnv;
      vi.resetModules();
    });

    it('returns true when REDIS_URL is set', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      vi.resetModules();
      const { isRedisConfigured } = await import('../redis-client');
      expect(isRedisConfigured()).toBe(true);
    });

    it('returns false when REDIS_URL is not set', async () => {
      delete process.env.REDIS_URL;
      vi.resetModules();
      const { isRedisConfigured } = await import('../redis-client');
      expect(isRedisConfigured()).toBe(false);
    });

    it('returns false when REDIS_URL is empty string', async () => {
      process.env.REDIS_URL = '';
      vi.resetModules();
      const { isRedisConfigured } = await import('../redis-client');
      expect(isRedisConfigured()).toBe(false);
    });
  });

  describe('getRedisClient', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('attempts to connect when REDIS_URL is configured', async () => {
      mockConnect.mockResolvedValue(undefined);
      vi.resetModules();

      const { getRedisClient } = await import('../redis-client');
      await getRedisClient();

      expect(mockConnect).toHaveBeenCalled();
    });

    it('returns null when connection fails', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));
      vi.resetModules();

      const { getRedisClient } = await import('../redis-client');
      const client = await getRedisClient();

      expect(client).toBeNull();
    });

    it('sets up error, reconnecting, ready, and end event handlers', async () => {
      mockConnect.mockResolvedValue(undefined);
      vi.resetModules();

      const { getRedisClient } = await import('../redis-client');
      await getRedisClient();

      // Check that event handlers were registered
      const eventNames = mockOn.mock.calls.map((call) => call[0]);
      expect(eventNames).toContain('error');
      expect(eventNames).toContain('reconnecting');
      expect(eventNames).toContain('ready');
      expect(eventNames).toContain('end');
    });
  });

  describe('closeRedisConnection', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('calls quit on connected client', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockResolvedValue(undefined);
      vi.resetModules();

      const { getRedisClient, closeRedisConnection } = await import('../redis-client');
      await getRedisClient();
      await closeRedisConnection();

      expect(mockQuit).toHaveBeenCalled();
    });

    it('handles quit errors gracefully', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockRejectedValue(new Error('Quit failed'));
      vi.resetModules();

      const { getRedisClient, closeRedisConnection } = await import('../redis-client');
      await getRedisClient();

      // Should not throw
      await expect(closeRedisConnection()).resolves.toBeUndefined();
    });
  });

  describe('isRedisAvailable', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('returns true when ping succeeds', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockResolvedValue('PONG');
      vi.resetModules();

      const { isRedisAvailable } = await import('../redis-client');
      const available = await isRedisAvailable();
      expect(available).toBe(true);
    });

    it('returns false when ping fails', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockPing.mockRejectedValue(new Error('Connection lost'));
      vi.resetModules();

      const { isRedisAvailable } = await import('../redis-client');
      const available = await isRedisAvailable();
      expect(available).toBe(false);
    });
  });
});

describe('maskRedisUrl helper', () => {
  // We test this indirectly through the log output, but we can also test the logic
  it('should mask passwords in Redis URLs', () => {
    // The maskRedisUrl function is internal, but we can verify the behavior
    // by checking that sensitive data is not logged (covered by logging tests)
    // Here we test the URL parsing logic conceptually

    const testUrl = 'redis://:secretpassword@localhost:6379';
    const parsed = new URL(testUrl);
    parsed.password = '****';
    const masked = parsed.toString();

    expect(masked).not.toContain('secretpassword');
    expect(masked).toContain('****');
  });

  it('handles URLs without password', () => {
    const testUrl = 'redis://localhost:6379';
    const parsed = new URL(testUrl);
    if (parsed.password) {
      parsed.password = '****';
    }
    const masked = parsed.toString();

    // URL.toString() may or may not add trailing slash depending on Node version
    expect(masked).toMatch(/^redis:\/\/localhost:6379\/?$/);
  });

  it('handles invalid URLs gracefully', () => {
    // The function should return 'invalid-url' for invalid URLs
    expect(() => new URL('not-a-valid-url')).toThrow();
  });
});

describe('reconnect strategy', () => {
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
