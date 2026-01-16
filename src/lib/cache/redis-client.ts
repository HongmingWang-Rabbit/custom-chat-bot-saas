/**
 * Redis Client (Upstash)
 *
 * Uses Upstash Redis REST client for serverless-friendly caching.
 * Works well with Vercel and other serverless platforms.
 *
 * Features:
 * - HTTP-based (no persistent connections needed)
 * - Automatic retries
 * - Graceful degradation when Redis unavailable
 */

import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

// Create a child logger for Redis
const log = logger.child({ layer: 'cache', service: 'RedisClient' });

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for Redis commands (ms) - used for reference, Upstash handles internally */
export const DEFAULT_COMMAND_TIMEOUT_MS = 3000;

// Legacy constants kept for backward compatibility with tests
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
export const MAX_RECONNECT_DELAY_MS = 30000;
export const RECONNECT_BACKOFF_BASE_MS = 100;

// =============================================================================
// Types
// =============================================================================

export interface RedisConfig {
  url: string;
  token: string;
}

// =============================================================================
// Configuration
// =============================================================================

function getRedisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

/**
 * Check if Redis is configured via environment variables.
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// =============================================================================
// Singleton Client
// =============================================================================

let redisClient: Redis | null = null;

/**
 * Get or create a Redis client.
 *
 * Uses singleton pattern with lazy initialization.
 * Returns null if Redis is not configured (graceful degradation).
 */
export async function getRedisClient(): Promise<Redis | null> {
  // Return existing client
  if (redisClient) {
    return redisClient;
  }

  const config = getRedisConfig();

  // Check if Redis is configured
  if (!config) {
    log.debug({ event: 'redis_not_configured' }, 'Upstash Redis not configured, caching disabled');
    return null;
  }

  try {
    log.info({ event: 'redis_init', url: maskRedisUrl(config.url) }, 'Initializing Upstash Redis client');

    redisClient = new Redis({
      url: config.url,
      token: config.token,
    });

    log.info({ event: 'redis_ready' }, 'Upstash Redis client initialized');
    return redisClient;
  } catch (error) {
    log.error(
      {
        event: 'redis_init_error',
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to initialize Upstash Redis client'
    );
    return null;
  }
}

/**
 * Close/reset the Redis client.
 * With Upstash REST client, this just clears the reference.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    redisClient = null;
    log.info({ event: 'redis_closed' }, 'Redis client reference cleared');
  }
}

/**
 * Check if Redis client is available and working.
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;

    // Ping to verify connection is working
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Reset the client (for testing purposes).
 */
export function resetRedisClient(): void {
  redisClient = null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mask Redis URL for logging (hide sensitive parts).
 */
function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Just show the host, hide everything else
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return 'invalid-url';
  }
}
