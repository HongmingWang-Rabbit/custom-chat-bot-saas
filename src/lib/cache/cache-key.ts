/**
 * Cache Key Generation
 *
 * Utilities for generating consistent cache keys from questions.
 * Keys are tenant-scoped and based on normalized question hashes.
 */

import crypto from 'crypto';

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_KEY_PREFIX = 'rag:qa:';

/** Length of the SHA-256 hash to use in cache keys (first N hex characters) */
export const HASH_LENGTH = 32;

// =============================================================================
// Question Normalization
// =============================================================================

/**
 * Normalize a question for consistent cache key generation.
 *
 * Steps:
 * 1. Convert to lowercase
 * 2. Remove trailing punctuation (?, !, .)
 * 3. Collapse multiple whitespace to single space
 * 4. Trim leading/trailing whitespace
 *
 * This ensures "What is AI?" and "what is ai" hit the same cache key.
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .trim()
    .replace(/[?!.]+$/g, '') // Remove trailing punctuation
    .replace(/\s+/g, ' '); // Collapse whitespace
}

// =============================================================================
// Cache Key Generation
// =============================================================================

/**
 * Generate a cache key from tenant slug and question.
 *
 * Format: {prefix}{tenantSlug}:{questionHash}
 * Example: rag:qa:acme-corp:a1b2c3d4e5f6...
 *
 * The question is normalized and hashed (SHA-256) to:
 * - Produce fixed-length keys regardless of question length
 * - Avoid special characters in keys
 * - Ensure consistent keys for equivalent questions
 *
 * @param tenantSlug - Unique tenant identifier
 * @param question - User's question (will be normalized)
 * @param prefix - Key prefix (default: 'rag:qa:')
 * @returns Cache key string
 */
export function generateCacheKey(
  tenantSlug: string,
  question: string,
  prefix: string = DEFAULT_KEY_PREFIX
): string {
  const normalized = normalizeQuestion(question);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, HASH_LENGTH);
  return `${prefix}${tenantSlug}:${hash}`;
}

/**
 * Generate a pattern for matching all cache keys for a tenant.
 * Used for cache invalidation.
 *
 * @param tenantSlug - Unique tenant identifier
 * @param prefix - Key prefix (default: 'rag:qa:')
 * @returns Glob pattern for Redis SCAN
 */
export function getTenantKeyPattern(
  tenantSlug: string,
  prefix: string = DEFAULT_KEY_PREFIX
): string {
  return `${prefix}${tenantSlug}:*`;
}
