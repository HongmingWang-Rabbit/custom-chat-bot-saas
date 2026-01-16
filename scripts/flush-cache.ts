/**
 * Flush RAG Cache Script
 *
 * Clears all cached RAG responses from Redis.
 *
 * Usage:
 *   npm run cache:flush
 */

import { getRAGCacheService } from '../src/lib/cache';

async function main() {
  console.log('Flushing RAG cache...');

  const cacheService = getRAGCacheService();

  if (!cacheService.isEnabled()) {
    console.log('Cache is not enabled or Redis is not configured.');
    console.log('Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables.');
    process.exit(0);
  }

  console.log('Connected to Redis, scanning for cache entries...');
  const deleted = await cacheService.flushAll();

  if (deleted === 0) {
    console.log('\n✓ Cache is already empty (0 entries)');
  } else {
    console.log(`\n✓ Flushed ${deleted} cached entries`);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
