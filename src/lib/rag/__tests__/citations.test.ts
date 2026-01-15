/**
 * Tests for citation service.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCitationContext,
  formatContextForPrompt,
  parseCitations,
  formatSourcesSection,
  validateCitations,
  calculateOverallConfidence,
  Citation,
} from '../citations';
import { RetrievedChunk } from '../retrieval';

// =============================================================================
// Test Fixtures
// =============================================================================

const createMockChunk = (
  id: string,
  docId: string,
  docTitle: string,
  content: string,
  similarity: number = 0.8
): RetrievedChunk => ({
  id,
  content,
  chunkIndex: 0,
  similarity,
  confidence: similarity,
  document: {
    id: docId,
    title: docTitle,
    source: `https://example.com/doc/${docId}`,
  },
});

const mockChunks: RetrievedChunk[] = [
  createMockChunk('chunk-1', 'doc-1', 'Q3 Earnings Report', 'Revenue was $150M in Q3.', 0.9),
  createMockChunk('chunk-2', 'doc-2', 'Risk Factors', 'Key risks include competition.', 0.85),
  createMockChunk('chunk-3', 'doc-1', 'Q3 Earnings Report', 'Growth was 25% YoY.', 0.8),
];

// =============================================================================
// Tests
// =============================================================================

describe('citations', () => {
  describe('buildCitationContext', () => {
    it('should create citation map from chunks', () => {
      const context = buildCitationContext(mockChunks);

      expect(context.chunks).toHaveLength(3);
      expect(context.citationMap.size).toBe(3);
      expect(context.citationMap.get('chunk-1')).toBe(1);
      expect(context.citationMap.get('chunk-2')).toBe(2);
      expect(context.citationMap.get('chunk-3')).toBe(3);
    });

    it('should handle empty chunks', () => {
      const context = buildCitationContext([]);

      expect(context.chunks).toHaveLength(0);
      expect(context.citationMap.size).toBe(0);
    });
  });

  describe('formatContextForPrompt', () => {
    it('should format chunks with citation numbers', () => {
      const context = buildCitationContext(mockChunks);
      const formatted = formatContextForPrompt(context);

      expect(formatted).toContain('[1]');
      expect(formatted).toContain('[2]');
      expect(formatted).toContain('[3]');
      expect(formatted).toContain('Q3 Earnings Report');
      expect(formatted).toContain('Risk Factors');
    });

    it('should include source titles', () => {
      const context = buildCitationContext(mockChunks);
      const formatted = formatContextForPrompt(context);

      expect(formatted).toContain('Source: Q3 Earnings Report');
      expect(formatted).toContain('Source: Risk Factors');
    });

    it('should separate chunks with dividers', () => {
      const context = buildCitationContext(mockChunks);
      const formatted = formatContextForPrompt(context);

      expect(formatted).toContain('---');
    });
  });

  describe('parseCitations', () => {
    it('should extract used citations from response', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Revenue was $150M [1]. Key risks include competition [2].';

      const result = parseCitations(response, context);

      expect(result.citations).toHaveLength(2);
      expect(result.usedChunkIds).toContain('chunk-1');
      expect(result.usedChunkIds).toContain('chunk-2');
    });

    it('should ignore invalid citation numbers', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Valid citation [1]. Invalid citation [99].';

      const result = parseCitations(response, context);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].id).toBe(1);
    });

    it('should handle multiple references to same citation', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'First mention [1]. Second mention [1]. Third [1].';

      const result = parseCitations(response, context);

      // Should only have one citation object
      expect(result.citations).toHaveLength(1);
    });

    it('should sort citations by number', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Third [3]. First [1]. Second [2].';

      const result = parseCitations(response, context);

      expect(result.citations[0].id).toBe(1);
      expect(result.citations[1].id).toBe(2);
      expect(result.citations[2].id).toBe(3);
    });

    it('should handle response with no citations', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'I do not have enough information to answer.';

      const result = parseCitations(response, context);

      expect(result.citations).toHaveLength(0);
      expect(result.usedChunkIds).toHaveLength(0);
    });

    it('should include chunk content in citations', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Revenue was $150M [1].';

      const result = parseCitations(response, context);

      expect(result.citations[0].chunkContent).toBe('Revenue was $150M in Q3.');
    });

    it('should include document metadata in citations', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Revenue info [1].';

      const result = parseCitations(response, context);

      expect(result.citations[0].documentId).toBe('doc-1');
      expect(result.citations[0].documentTitle).toBe('Q3 Earnings Report');
      expect(result.citations[0].source).toContain('example.com');
    });
  });

  describe('formatSourcesSection', () => {
    it('should format unique sources', () => {
      const citations: Citation[] = [
        {
          id: 1,
          documentId: 'doc-1',
          documentTitle: 'Report A',
          chunkContent: 'Content',
          chunkIndex: 0,
          confidence: 0.9,
          source: 'https://example.com/a',
        },
        {
          id: 2,
          documentId: 'doc-2',
          documentTitle: 'Report B',
          chunkContent: 'Content',
          chunkIndex: 0,
          confidence: 0.8,
          source: 'https://example.com/b',
        },
      ];

      const formatted = formatSourcesSection(citations);

      expect(formatted).toContain('**Sources:**');
      expect(formatted).toContain('1. Report A');
      expect(formatted).toContain('2. Report B');
    });

    it('should deduplicate sources from same document', () => {
      const citations: Citation[] = [
        {
          id: 1,
          documentId: 'doc-1',
          documentTitle: 'Same Report',
          chunkContent: 'Content 1',
          chunkIndex: 0,
          confidence: 0.9,
          source: null,
        },
        {
          id: 2,
          documentId: 'doc-1',
          documentTitle: 'Same Report',
          chunkContent: 'Content 2',
          chunkIndex: 1,
          confidence: 0.8,
          source: null,
        },
      ];

      const formatted = formatSourcesSection(citations);

      // Should only list the document once
      const matches = formatted.match(/Same Report/g) || [];
      expect(matches).toHaveLength(1);
    });

    it('should return empty string for no citations', () => {
      const formatted = formatSourcesSection([]);
      expect(formatted).toBe('');
    });
  });

  describe('validateCitations', () => {
    it('should validate proper citations', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Info from [1] and [2].';

      const result = validateCitations(response, context);

      expect(result.isValid).toBe(true);
      expect(result.hasCitations).toBe(true);
      expect(result.invalidCitations).toHaveLength(0);
    });

    it('should detect invalid citations', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Info from [1] and [99].';

      const result = validateCitations(response, context);

      expect(result.isValid).toBe(false);
      expect(result.invalidCitations).toContain(99);
    });

    it('should detect unused chunks', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Only using [1].';

      const result = validateCitations(response, context);

      expect(result.unusedChunks).toContain(2);
      expect(result.unusedChunks).toContain(3);
    });

    it('should handle response with no citations', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'No citations here.';

      const result = validateCitations(response, context);

      expect(result.hasCitations).toBe(false);
      expect(result.isValid).toBe(true); // No invalid citations
    });

    it('should handle citation number 0 as invalid', () => {
      const context = buildCitationContext(mockChunks);
      const response = 'Invalid [0] citation.';

      const result = validateCitations(response, context);

      expect(result.invalidCitations).toContain(0);
    });
  });

  describe('calculateOverallConfidence', () => {
    it('should calculate average confidence', () => {
      const citations: Citation[] = [
        { id: 1, documentId: 'd1', documentTitle: 'T1', chunkContent: '', chunkIndex: 0, confidence: 0.9, source: null },
        { id: 2, documentId: 'd2', documentTitle: 'T2', chunkContent: '', chunkIndex: 0, confidence: 0.8, source: null },
        { id: 3, documentId: 'd3', documentTitle: 'T3', chunkContent: '', chunkIndex: 0, confidence: 0.7, source: null },
      ];

      const confidence = calculateOverallConfidence(citations);

      expect(confidence).toBeCloseTo(0.8); // (0.9 + 0.8 + 0.7) / 3
    });

    it('should return 0 for no citations', () => {
      const confidence = calculateOverallConfidence([]);
      expect(confidence).toBe(0);
    });

    it('should handle single citation', () => {
      const citations: Citation[] = [
        { id: 1, documentId: 'd1', documentTitle: 'T1', chunkContent: '', chunkIndex: 0, confidence: 0.95, source: null },
      ];

      const confidence = calculateOverallConfidence(citations);

      expect(confidence).toBe(0.95);
    });
  });
});
