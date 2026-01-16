/**
 * Tests for cache key generation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeQuestion,
  generateCacheKey,
  getTenantKeyPattern,
  DEFAULT_KEY_PREFIX,
  HASH_LENGTH,
} from '../cache-key';

describe('cache-key', () => {
  describe('normalizeQuestion', () => {
    it('converts to lowercase', () => {
      expect(normalizeQuestion('What Is AI?')).toBe('what is ai');
    });

    it('removes trailing question marks', () => {
      expect(normalizeQuestion('What is AI?')).toBe('what is ai');
      expect(normalizeQuestion('What is AI???')).toBe('what is ai');
    });

    it('removes trailing exclamation marks', () => {
      expect(normalizeQuestion('Tell me about AI!')).toBe('tell me about ai');
    });

    it('removes trailing periods', () => {
      expect(normalizeQuestion('Explain AI.')).toBe('explain ai');
    });

    it('collapses multiple whitespace', () => {
      expect(normalizeQuestion('What   is    AI')).toBe('what is ai');
      expect(normalizeQuestion('What\t\nis\n\nAI')).toBe('what is ai');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeQuestion('  What is AI?  ')).toBe('what is ai');
    });

    it('handles empty strings', () => {
      expect(normalizeQuestion('')).toBe('');
      expect(normalizeQuestion('   ')).toBe('');
    });

    it('preserves internal punctuation', () => {
      expect(normalizeQuestion("What's the CEO's strategy?")).toBe(
        "what's the ceo's strategy"
      );
    });

    it('normalizes equivalent questions to same result', () => {
      const variations = [
        'What is AI?',
        'what is ai',
        'What is AI',
        'WHAT IS AI?',
        '  what   is  ai?  ',
        'What is AI???',
      ];

      const normalized = variations.map(normalizeQuestion);
      expect(new Set(normalized).size).toBe(1);
      expect(normalized[0]).toBe('what is ai');
    });
  });

  describe('generateCacheKey', () => {
    it('generates consistent keys for same tenant and question', () => {
      const key1 = generateCacheKey('acme-corp', 'What is AI?');
      const key2 = generateCacheKey('acme-corp', 'What is AI?');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different tenants', () => {
      const key1 = generateCacheKey('acme-corp', 'What is AI?');
      const key2 = generateCacheKey('other-corp', 'What is AI?');
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different questions', () => {
      const key1 = generateCacheKey('acme-corp', 'What is AI?');
      const key2 = generateCacheKey('acme-corp', 'What is ML?');
      expect(key1).not.toBe(key2);
    });

    it('generates same key for normalized equivalent questions', () => {
      const key1 = generateCacheKey('acme-corp', 'What is AI?');
      const key2 = generateCacheKey('acme-corp', 'what is ai');
      const key3 = generateCacheKey('acme-corp', '  WHAT IS AI??  ');
      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('uses default prefix', () => {
      const key = generateCacheKey('acme-corp', 'What is AI?');
      expect(key.startsWith(DEFAULT_KEY_PREFIX)).toBe(true);
    });

    it('allows custom prefix', () => {
      const customPrefix = 'custom:prefix:';
      const key = generateCacheKey('acme-corp', 'What is AI?', customPrefix);
      expect(key.startsWith(customPrefix)).toBe(true);
      expect(key.startsWith(DEFAULT_KEY_PREFIX)).toBe(false);
    });

    it('includes tenant slug in key', () => {
      const key = generateCacheKey('acme-corp', 'What is AI?');
      expect(key).toContain('acme-corp');
    });

    it('generates fixed-length hash portion', () => {
      const key1 = generateCacheKey('test', 'short');
      const key2 = generateCacheKey(
        'test',
        'A very long question that goes on and on and on'
      );

      // Both should have HASH_LENGTH-char hash after tenant slug
      const hash1 = key1.split(':').pop();
      const hash2 = key2.split(':').pop();
      expect(hash1?.length).toBe(HASH_LENGTH);
      expect(hash2?.length).toBe(HASH_LENGTH);
    });
  });

  describe('getTenantKeyPattern', () => {
    it('generates glob pattern for tenant', () => {
      const pattern = getTenantKeyPattern('acme-corp');
      expect(pattern).toBe(`${DEFAULT_KEY_PREFIX}acme-corp:*`);
    });

    it('allows custom prefix', () => {
      const customPrefix = 'custom:';
      const pattern = getTenantKeyPattern('acme-corp', customPrefix);
      expect(pattern).toBe('custom:acme-corp:*');
    });

    it('matches all cache keys for tenant', () => {
      const key = generateCacheKey('acme-corp', 'What is AI?');
      const pattern = getTenantKeyPattern('acme-corp');

      // Convert glob pattern to regex for testing
      const regex = new RegExp(pattern.replace('*', '.*'));
      expect(regex.test(key)).toBe(true);
    });

    it('does not match other tenants', () => {
      const key = generateCacheKey('other-corp', 'What is AI?');
      const pattern = getTenantKeyPattern('acme-corp');

      const regex = new RegExp(pattern.replace('*', '.*'));
      expect(regex.test(key)).toBe(false);
    });
  });
});
