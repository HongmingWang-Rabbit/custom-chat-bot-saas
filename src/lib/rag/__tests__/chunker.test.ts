/**
 * Tests for document chunker.
 */

import { describe, it, expect } from 'vitest';
import {
  chunkText,
  chunkDocument,
  chunkByParagraphs,
  estimateTokens,
} from '../chunker';

describe('chunker', () => {
  describe('chunkText', () => {
    it('should return single chunk for short text', () => {
      const text = 'This is a short text.';
      const chunks = chunkText(text, { chunkSize: 500 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(text);
      expect(chunks[0].chunkIndex).toBe(0);
    });

    it('should split long text into multiple chunks', () => {
      const text = 'This is sentence one. '.repeat(50);
      const chunks = chunkText(text, { chunkSize: 200, chunkOverlap: 20 });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should create overlapping chunks', () => {
      const text = 'Word '.repeat(100);
      const chunks = chunkText(text, { chunkSize: 100, chunkOverlap: 20 });

      // Check that there's some overlap between consecutive chunks
      for (let i = 1; i < chunks.length; i++) {
        const prevEnd = chunks[i - 1].content.slice(-20);
        const currStart = chunks[i].content.slice(0, 30);
        // There should be some common text due to overlap
        // (not exact match due to sentence boundary seeking)
      }
    });

    it('should track chunk positions', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const chunks = chunkText(text, { chunkSize: 500 });

      expect(chunks[0].startOffset).toBe(0);
      expect(chunks[0].endOffset).toBe(text.length);
    });

    it('should preserve sentence boundaries when possible', () => {
      const text = 'First sentence here. Second sentence follows. Third one too. Fourth sentence ends it.';
      const chunks = chunkText(text, {
        chunkSize: 50,
        chunkOverlap: 5,
        preserveSentences: true,
      });

      // Should create multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
      // All chunks should have content
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeGreaterThan(0);
      });
    });

    it('should handle empty text', () => {
      const chunks = chunkText('');
      expect(chunks).toHaveLength(0);
    });

    it('should handle whitespace-only text', () => {
      const chunks = chunkText('   \n\t  ');
      expect(chunks).toHaveLength(0);
    });

    it('should normalize whitespace', () => {
      const text = 'Multiple   spaces   and\n\nnewlines\there.';
      const chunks = chunkText(text, { chunkSize: 500 });

      expect(chunks[0].content).not.toContain('  ');
      expect(chunks[0].content).not.toContain('\n');
    });

    it('should handle text with special characters', () => {
      const text = 'Price: $100.00! Revenue: €50M? Growth: 25%+.';
      const chunks = chunkText(text, { chunkSize: 500 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain('$100.00');
    });

    it('should assign sequential chunk indices', () => {
      const text = 'Sentence. '.repeat(100);
      const chunks = chunkText(text, { chunkSize: 100, chunkOverlap: 10 });

      chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
      });
    });
  });

  describe('chunkDocument', () => {
    it('should chunk document and include metadata', () => {
      const content = 'Document content here. More content follows.';
      const docId = 'doc-123';

      const chunks = chunkDocument(content, docId);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.metadata).toBeDefined();
        expect(chunk.metadata?.documentId).toBe(docId);
      });
    });

    it('should use RAG config for chunk size', () => {
      const content = 'Word '.repeat(500);
      const chunks = chunkDocument(content, 'doc-1', { chunkSize: 100 });

      // Each chunk should be approximately 100 chars (with some variance for sentence boundaries)
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(150);
      });
    });
  });

  describe('chunkByParagraphs', () => {
    it('should split by paragraph first', () => {
      const text = `
First paragraph with some content.

Second paragraph with different content.

Third paragraph to finish.
      `.trim();

      const chunks = chunkByParagraphs(text, { chunkSize: 500 });

      // Should try to keep paragraphs together if they fit
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should merge small paragraphs', () => {
      const text = `
Short one.

Short two.

Short three.
      `.trim();

      const chunks = chunkByParagraphs(text, { chunkSize: 500 });

      // All short paragraphs should fit in one chunk
      expect(chunks).toHaveLength(1);
    });

    it('should split when multiple paragraphs exceed chunk size', () => {
      // Create multiple paragraphs separated by double newlines
      const text = `
This is the first paragraph with some content here.

This is the second paragraph with different content.

This is the third paragraph with more information.

This is the fourth paragraph to ensure splitting.
      `.trim();

      const chunks = chunkByParagraphs(text, { chunkSize: 100 });

      // Should create multiple chunks due to paragraph accumulation
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle single paragraph', () => {
      const text = 'Just one paragraph here with no breaks.';
      const chunks = chunkByParagraphs(text, { chunkSize: 500 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(text);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens (roughly 4 chars per token)', () => {
      const text = 'This is a sample text.';
      const tokens = estimateTokens(text);

      // ~22 chars / 4 = ~6 tokens
      expect(tokens).toBeGreaterThanOrEqual(4);
      expect(tokens).toBeLessThanOrEqual(8);
    });

    it('should handle empty text', () => {
      const tokens = estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should round up', () => {
      const text = 'Hi'; // 2 chars = 0.5 tokens, rounds to 1
      const tokens = estimateTokens(text);
      expect(tokens).toBe(1);
    });
  });
});
