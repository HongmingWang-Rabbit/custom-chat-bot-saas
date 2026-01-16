/**
 * Redis Client
 *
 * Singleton Redis client with connection management.
 * Follows the same patterns as db/client.ts for consistency.
 *
 * Features:
 * - Lazy connection on first use
 * - Automatic reconnection on disconnect
 * - Graceful degradation when Redis unavailable
 * - Proper cleanup on shutdown
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '@/lib/logger';

// Create a child logger for Redis
const log = logger.child({ layer: 'cache', service: 'RedisClient' });

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for establishing Redis connection (ms) */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** Default timeout for individual Redis commands (ms) */
export const DEFAULT_COMMAND_TIMEOUT_MS = 3000;

/** Maximum delay between reconnection attempts (ms) */
export const MAX_RECONNECT_DELAY_MS = 30000;

/** Base delay multiplier for reconnection backoff (ms) */
export const RECONNECT_BACKOFF_BASE_MS = 100;

// =============================================================================
// Types
// =============================================================================

export interface RedisConfig {
  url: string;
  connectTimeout: number;
  commandTimeout: number;
}

// =============================================================================
// Configuration
// =============================================================================

function getRedisConfig(): RedisConfig {
  return {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
    commandTimeout: DEFAULT_COMMAND_TIMEOUT_MS,
  };
}

/**
 * Check if Redis is configured via environment variables.
 */
export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}

// =============================================================================
// Singleton Client
// =============================================================================

let redisClient: RedisClientType | null = null;
let connectionPromise: Promise<RedisClientType | null> | null = null;
let isConnecting = false;

/**
 * Get or create a Redis client connection.
 *
 * Uses singleton pattern with lazy initialization.
 * Returns null if Redis is unavailable (graceful degradation).
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  // Return existing connected client
  if (redisClient?.isOpen) {
    return redisClient;
  }

  // Return pending connection promise to avoid duplicate connections
  if (connectionPromise && isConnecting) {
    return connectionPromise;
  }

  const config = getRedisConfig();

  // Check if Redis URL is configured
  if (!config.url) {
    log.debug({ event: 'redis_not_configured' }, 'Redis URL not configured, caching disabled');
    return null;
  }

  isConnecting = true;
  connectionPromise = connectToRedis(config);

  try {
    const client = await connectionPromise;
    isConnecting = false;
    return client;
  } catch {
    isConnecting = false;
    connectionPromise = null;
    return null;
  }
}

/**
 * Establish connection to Redis.
 */
async function connectToRedis(config: RedisConfig): Promise<RedisClientType | null> {
  try {
    log.info({ event: 'redis_connecting', url: maskRedisUrl(config.url) }, 'Connecting to Redis');

    const client = createClient({
      url: config.url,
      socket: {
        connectTimeout: config.connectTimeout,
        reconnectStrategy: (retries) => {
          // Exponential backoff with max delay
          const delay = Math.min(retries * RECONNECT_BACKOFF_BASE_MS, MAX_RECONNECT_DELAY_MS);
          log.debug(
            { event: 'redis_reconnect', retries, delay_ms: delay },
            `Reconnecting to Redis in ${delay}ms`
          );
          return delay;
        },
      },
    });

    // Set up event handlers
    client.on('error', (err) => {
      log.error({ event: 'redis_error', error: err.message }, 'Redis client error');
    });

    client.on('reconnecting', () => {
      log.info({ event: 'redis_reconnecting' }, 'Redis client reconnecting');
    });

    client.on('ready', () => {
      log.info({ event: 'redis_ready' }, 'Redis client ready');
    });

    client.on('end', () => {
      log.info({ event: 'redis_disconnected' }, 'Redis client disconnected');
      redisClient = null;
    });

    await client.connect();

    log.info({ event: 'redis_connected' }, 'Redis client connected');
    redisClient = client as RedisClientType;
    return redisClient;
  } catch (error) {
    log.error(
      {
        event: 'redis_connect_error',
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to connect to Redis'
    );
    return null;
  }
}

/**
 * Close the Redis connection.
 * Call during application shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient?.isOpen) {
    try {
      await redisClient.quit();
      log.info({ event: 'redis_closed' }, 'Redis connection closed gracefully');
    } catch (error) {
      log.error(
        { event: 'redis_close_error', error: error instanceof Error ? error.message : String(error) },
        'Error closing Redis connection'
      );
    } finally {
      redisClient = null;
      connectionPromise = null;
    }
  }
}

/**
 * Check if Redis client is connected and ready.
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client?.isOpen) return false;

    // Ping to verify connection is working
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mask Redis URL for logging (hide password if present).
 */
function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return 'invalid-url';
  }
}
