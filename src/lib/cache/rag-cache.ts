/**
 * RAG Cache Service
 *
 * Caches full Q&A responses to reduce LLM API costs
 * and improve response latency for repeated questions.
 *
 * Features:
 * - Per-tenant isolation via cache keys
 * - Configurable TTL
 * - Cache version tracking for schema migrations
 * - Graceful degradation when Redis unavailable
 * - Tenant-level cache invalidation
 */

import { getRedisClient, isRedisConfigured } from './redis-client';
import { generateCacheKey, getTenantKeyPattern } from './cache-key';
import { logger } from '@/lib/logger';

// Create a child logger for RAG cache
const log = logger.child({ layer: 'cache', service: 'RAGCache' });

// =============================================================================
// Types
// =============================================================================

/**
 * Citation structure matching src/lib/rag/citations.ts
 */
export interface CachedCitation {
  id: number;
  documentId: string;
  documentTitle: string;
  chunkContent: string;
  chunkIndex: number;
  confidence: number;
  source: string | null;
}

/**
 * RAG response structure matching src/lib/rag/service.ts
 */
export interface CacheableRAGResponse {
  answer: string;
  citations: CachedCitation[];
  confidence: number;
  retrievedChunks: number;
  tokensUsed: {
    embedding: number;
    completion: number;
  };
  timing: {
    retrieval_ms: number;
    llm_ms: number;
  };
}

/**
 * Cached RAG response with metadata.
 */
interface CachedRAGResponse extends CacheableRAGResponse {
  cachedAt: string;
  cacheVersion: string;
  originalQuery: string;
}

/**
 * Cache configuration.
 */
export interface RAGCacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  keyPrefix: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Cache version - increment when response structure changes.
 * This ensures stale cached data with incompatible structure is invalidated.
 */
export const CACHE_VERSION = '1.0.0';

/**
 * Default TTL: 1 hour
 */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * Number of keys to scan per iteration when invalidating tenant cache.
 * Higher values are faster but use more memory.
 */
const SCAN_BATCH_SIZE = 100;

// =============================================================================
// Configuration
// =============================================================================

function getCacheConfig(): RAGCacheConfig {
  return {
    enabled: process.env.RAG_CACHE_ENABLED !== 'false',
    ttlSeconds: parseInt(process.env.RAG_CACHE_TTL_SECONDS || String(DEFAULT_TTL_SECONDS), 10),
    keyPrefix: process.env.RAG_CACHE_KEY_PREFIX || 'rag:qa:',
  };
}

// =============================================================================
// RAG Cache Service
// =============================================================================

/**
 * RAG Cache Service
 *
 * Provides caching for RAG query responses with:
 * - Per-tenant isolation
 * - Configurable TTL
 * - Cache hit/miss metrics
 * - Graceful degradation when Redis unavailable
 */
export class RAGCacheService {
  private config: RAGCacheConfig;

  constructor(config?: Partial<RAGCacheConfig>) {
    this.config = { ...getCacheConfig(), ...config };
  }

  /**
   * Check if caching is enabled and available.
   */
  isEnabled(): boolean {
    return this.config.enabled && isRedisConfigured();
  }

  /**
   * Attempt to get a cached response.
   * Returns null if not found, cache disabled, or Redis unavailable.
   */
  async get(tenantSlug: string, question: string): Promise<CacheableRAGResponse | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const startTime = Date.now();
    const cacheKey = generateCacheKey(tenantSlug, question, this.config.keyPrefix);

    try {
      const client = await getRedisClient();
      if (!client) {
        log.debug({ event: 'cache_skip', reason: 'no_client' }, 'Redis not available');
        return null;
      }

      const cached = await client.get<CachedRAGResponse>(cacheKey);

      if (!cached) {
        log.debug(
          { event: 'cache_miss', tenant: tenantSlug, duration_ms: Date.now() - startTime },
          'Cache miss'
        );
        return null;
      }

      // Upstash auto-deserializes JSON, so cached is already parsed
      const parsed = cached;

      // Version check - invalidate if schema changed
      if (parsed.cacheVersion !== CACHE_VERSION) {
        log.debug(
          {
            event: 'cache_version_mismatch',
            tenant: tenantSlug,
            cached: parsed.cacheVersion,
            current: CACHE_VERSION,
          },
          'Cache version mismatch, treating as miss'
        );
        await client.del(cacheKey);
        return null;
      }

      log.info(
        { event: 'cache_hit', tenant: tenantSlug, duration_ms: Date.now() - startTime },
        'Cache hit'
      );

      // Return response without cache metadata
      return {
        answer: parsed.answer,
        citations: parsed.citations,
        confidence: parsed.confidence,
        retrievedChunks: parsed.retrievedChunks,
        tokensUsed: parsed.tokensUsed,
        timing: parsed.timing,
      };
    } catch (error) {
      log.error(
        {
          event: 'cache_get_error',
          tenant: tenantSlug,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error reading from cache'
      );
      return null;
    }
  }

  /**
   * Store a response in cache.
   */
  async set(tenantSlug: string, question: string, response: CacheableRAGResponse): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const cacheKey = generateCacheKey(tenantSlug, question, this.config.keyPrefix);

    try {
      const client = await getRedisClient();
      if (!client) {
        return;
      }

      const cached: CachedRAGResponse = {
        ...response,
        cachedAt: new Date().toISOString(),
        cacheVersion: CACHE_VERSION,
        originalQuery: question,
      };

      await client.set(cacheKey, cached, { ex: this.config.ttlSeconds });

      log.debug(
        { event: 'cache_set', tenant: tenantSlug, ttl: this.config.ttlSeconds },
        'Response cached'
      );
    } catch (error) {
      log.error(
        {
          event: 'cache_set_error',
          tenant: tenantSlug,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error writing to cache'
      );
    }
  }

  /**
   * Invalidate all cached responses for a tenant.
   * Call when documents are updated/deleted.
   *
   * @returns Number of keys deleted
   */
  async invalidateTenant(tenantSlug: string): Promise<number> {
    if (!this.isEnabled()) {
      return 0;
    }

    try {
      const client = await getRedisClient();
      if (!client) {
        return 0;
      }

      const pattern = getTenantKeyPattern(tenantSlug, this.config.keyPrefix);

      // Use SCAN to find keys (safer than KEYS for large datasets)
      let cursor = 0;
      let deletedCount = 0;

      do {
        // Upstash scan returns [cursor, keys] tuple
        const [nextCursor, keys] = await client.scan(cursor, { match: pattern, count: SCAN_BATCH_SIZE });
        cursor = nextCursor;

        if (keys.length > 0) {
          await client.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== 0);

      if (deletedCount > 0) {
        log.info(
          { event: 'cache_invalidate_tenant', tenant: tenantSlug, deleted: deletedCount },
          `Invalidated ${deletedCount} cached responses for tenant`
        );
      }

      return deletedCount;
    } catch (error) {
      log.error(
        {
          event: 'cache_invalidate_error',
          tenant: tenantSlug,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error invalidating cache'
      );
      return 0;
    }
  }

  /**
   * Get cache statistics for monitoring.
   */
  getConfig(): RAGCacheConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let cacheServiceInstance: RAGCacheService | null = null;

/**
 * Get the singleton RAG cache service instance.
 */
export function getRAGCacheService(): RAGCacheService {
  if (!cacheServiceInstance) {
    cacheServiceInstance = new RAGCacheService();
  }
  return cacheServiceInstance;
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetRAGCacheService(): void {
  cacheServiceInstance = null;
}
