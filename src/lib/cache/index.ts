/**
 * Cache Module
 *
 * Provides Redis-based caching for the RAG pipeline.
 */

// Cache key utilities
export {
  normalizeQuestion,
  generateCacheKey,
  getTenantKeyPattern,
  DEFAULT_KEY_PREFIX,
  HASH_LENGTH,
} from './cache-key';

// Redis client
export {
  getRedisClient,
  closeRedisConnection,
  isRedisAvailable,
  isRedisConfigured,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_BACKOFF_BASE_MS,
} from './redis-client';

// RAG cache service
export {
  RAGCacheService,
  getRAGCacheService,
  resetRAGCacheService,
  CACHE_VERSION,
  type CacheableRAGResponse,
  type CachedCitation,
  type RAGCacheConfig,
} from './rag-cache';
