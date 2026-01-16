/**
 * Tests for Document Summarization Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store mock function references for assertions
const mockComplete = vi.fn();

// Mock the LLM adapter
vi.mock('@/lib/llm', () => ({
  createLLMAdapterFromConfig: vi.fn(() => ({
    complete: mockComplete,
  })),
}));

// Mock config to control feature flags in tests
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>();
  return {
    ...actual,
    SUMMARIZATION_ENABLED: true,
    SUMMARY_MAX_CONCURRENT: 2,
  };
});

import {
  isBroadQuestion,
  buildSummaryContext,
  summarizeDocuments,
  type DocumentSummary,
} from '../summarization';
import type { RetrievedChunk } from '../retrieval';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    content: 'This is the chunk content for testing.',
    chunkIndex: 0,
    similarity: 0.85,
    confidence: 0.8,
    document: {
      id: 'doc-1',
      title: 'Annual Report 2023',
      source: 'https://example.com/report.pdf',
    },
    ...overrides,
  };
}

// =============================================================================
// isBroadQuestion Tests
// =============================================================================

describe('isBroadQuestion', () => {
  // ===========================================================================
  // Broad Questions (should return true)
  // ===========================================================================

  describe('broad questions', () => {
    it('should detect "summarize" queries', () => {
      expect(isBroadQuestion('Summarize the annual report')).toBe(true);
      expect(isBroadQuestion('Can you summarize the key findings?')).toBe(true);
      expect(isBroadQuestion('Please SUMMARIZE the document')).toBe(true);
    });

    it('should detect "overview" queries', () => {
      expect(isBroadQuestion('Give me an overview of the company')).toBe(true);
      expect(isBroadQuestion('I need an overview')).toBe(true);
      expect(isBroadQuestion('Company overview please')).toBe(true);
    });

    it('should detect "what overall" queries', () => {
      expect(isBroadQuestion('What is the overall financial performance?')).toBe(true);
      expect(isBroadQuestion('What was the overall revenue trend?')).toBe(true);
    });

    it('should detect "tell me about" queries', () => {
      expect(isBroadQuestion('Tell me about the company strategy')).toBe(true);
      expect(isBroadQuestion('Can you tell me about the risk factors?')).toBe(true);
    });

    it('should detect "explain company" queries', () => {
      expect(isBroadQuestion('Explain the company performance')).toBe(true);
      expect(isBroadQuestion("Can you explain the company's growth?")).toBe(true);
    });

    it('should detect "how perform" queries', () => {
      expect(isBroadQuestion('How did the company perform this year?')).toBe(true);
      expect(isBroadQuestion('How is the product line performing?')).toBe(true);
    });

    it('should detect "financial performance" queries', () => {
      expect(isBroadQuestion('What was the financial performance?')).toBe(true);
      expect(isBroadQuestion('Describe the financial performance in Q3')).toBe(true);
    });

    it('should detect "key point" queries', () => {
      expect(isBroadQuestion('What are the key points?')).toBe(true);
      expect(isBroadQuestion('List the key points from the report')).toBe(true);
    });

    it('should detect "main takeaway" queries', () => {
      expect(isBroadQuestion('What are the main takeaways?')).toBe(true);
      expect(isBroadQuestion('Main takeaway from the earnings call')).toBe(true);
    });

    it('should detect "high level" queries', () => {
      expect(isBroadQuestion('Give me a high level summary')).toBe(true);
      expect(isBroadQuestion('High level overview please')).toBe(true);
    });

    it('should detect "in general" queries', () => {
      expect(isBroadQuestion('How is the company doing in general?')).toBe(true);
      expect(isBroadQuestion('In general, what are the risks?')).toBe(true);
    });

    it('should detect "compare" queries', () => {
      expect(isBroadQuestion('Compare the Q1 and Q2 results')).toBe(true);
      expect(isBroadQuestion('How does this compare to last year?')).toBe(true);
    });

    it('should detect "trend" queries', () => {
      expect(isBroadQuestion('What are the revenue trends?')).toBe(true);
      expect(isBroadQuestion('Show me the trend in expenses')).toBe(true);
    });

    it('should detect "across year" queries', () => {
      expect(isBroadQuestion('How did revenue change across years?')).toBe(true);
      expect(isBroadQuestion('Performance across year comparison')).toBe(true);
    });

    it('should detect "year over year" queries', () => {
      expect(isBroadQuestion('What is the year over year growth?')).toBe(true);
      expect(isBroadQuestion('Year-over-year revenue change')).toBe(true);
    });
  });

  // ===========================================================================
  // Specific Questions (should return false)
  // ===========================================================================

  describe('specific questions', () => {
    it('should not detect specific data point queries', () => {
      expect(isBroadQuestion('What was the Q3 revenue?')).toBe(false);
      expect(isBroadQuestion('What is the CEO name?')).toBe(false);
      expect(isBroadQuestion('How many employees does the company have?')).toBe(false);
    });

    it('should not detect specific factual queries', () => {
      expect(isBroadQuestion('When was the company founded?')).toBe(false);
      expect(isBroadQuestion('What is the stock ticker symbol?')).toBe(false);
      expect(isBroadQuestion('Where is the headquarters located?')).toBe(false);
    });

    it('should not detect specific metric queries', () => {
      expect(isBroadQuestion('What is the gross margin?')).toBe(false);
      expect(isBroadQuestion('What was the EPS for 2023?')).toBe(false);
      expect(isBroadQuestion('How much debt does the company have?')).toBe(false);
    });

    it('should return false for empty or simple queries', () => {
      expect(isBroadQuestion('')).toBe(false);
      expect(isBroadQuestion('hello')).toBe(false);
      expect(isBroadQuestion('revenue')).toBe(false);
    });
  });

  // ===========================================================================
  // Case Sensitivity
  // ===========================================================================

  describe('case sensitivity', () => {
    it('should be case insensitive', () => {
      expect(isBroadQuestion('SUMMARIZE the report')).toBe(true);
      expect(isBroadQuestion('Overview of the company')).toBe(true);
      expect(isBroadQuestion('TELL ME ABOUT the strategy')).toBe(true);
      expect(isBroadQuestion('Compare revenues')).toBe(true);
    });
  });
});

// =============================================================================
// buildSummaryContext Tests
// =============================================================================

describe('buildSummaryContext', () => {
  it('should build formatted context from summaries', () => {
    const summaries: DocumentSummary[] = [
      {
        documentId: 'doc-1',
        documentTitle: 'Annual Report',
        summary: 'Revenue increased by 20% year over year.',
        chunkCount: 3,
        confidence: 0.85,
        source: 'https://example.com/report.pdf',
      },
      {
        documentId: 'doc-2',
        documentTitle: 'Q4 Earnings',
        summary: 'Strong performance driven by new product launch.',
        chunkCount: 2,
        confidence: 0.78,
        source: null,
      },
    ];

    const result = buildSummaryContext(summaries);

    expect(result).toContain('[Document 1: Annual Report]');
    expect(result).toContain('Revenue increased by 20% year over year.');
    expect(result).toContain('Based on 3 sections, confidence: 85%');
    expect(result).toContain('[Document 2: Q4 Earnings]');
    expect(result).toContain('Strong performance driven by new product launch.');
    expect(result).toContain('Based on 2 sections, confidence: 78%');
    expect(result).toContain('---'); // separator between documents
  });

  it('should handle single summary', () => {
    const summaries: DocumentSummary[] = [
      {
        documentId: 'doc-1',
        documentTitle: 'Single Document',
        summary: 'This is the only summary.',
        chunkCount: 1,
        confidence: 0.9,
        source: null,
      },
    ];

    const result = buildSummaryContext(summaries);

    expect(result).toContain('[Document 1: Single Document]');
    expect(result).toContain('This is the only summary.');
    expect(result).toContain('confidence: 90%');
    expect(result).not.toContain('---'); // no separator for single doc
  });

  it('should handle empty summaries array', () => {
    const result = buildSummaryContext([]);

    expect(result).toBe('');
  });

  it('should round confidence percentages', () => {
    const summaries: DocumentSummary[] = [
      {
        documentId: 'doc-1',
        documentTitle: 'Test Doc',
        summary: 'Test summary',
        chunkCount: 1,
        confidence: 0.876,
        source: null,
      },
    ];

    const result = buildSummaryContext(summaries);

    expect(result).toContain('confidence: 88%'); // Math.round(87.6) = 88
  });
});

// =============================================================================
// summarizeDocuments Tests
// =============================================================================

describe('summarizeDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Successful Summarization
  // ===========================================================================

  describe('successful summarization', () => {
    it('should summarize documents and return results', async () => {
      mockComplete.mockResolvedValue({
        content: 'This is a summary of the document.',
        usage: { totalTokens: 100 },
      });

      const chunks = [
        createMockChunk({ id: 'chunk-1', document: { id: 'doc-1', title: 'Report 1', source: null } }),
        createMockChunk({ id: 'chunk-2', document: { id: 'doc-1', title: 'Report 1', source: null } }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize the report', 'sk-test-key');

      expect(result.summaries).toHaveLength(1);
      expect(result.summaries[0].documentTitle).toBe('Report 1');
      expect(result.summaries[0].summary).toBe('This is a summary of the document.');
      expect(result.summaries[0].chunkCount).toBe(2);
      expect(result.originalChunks).toBe(chunks);
      expect(result.tokensUsed).toBe(100);
    });

    it('should summarize multiple documents in parallel with concurrency limit', async () => {
      mockComplete.mockResolvedValue({
        content: 'Summary content',
        usage: { totalTokens: 50 },
      });

      const chunks = [
        createMockChunk({ id: 'chunk-1', document: { id: 'doc-1', title: 'Report 1', source: null } }),
        createMockChunk({ id: 'chunk-2', document: { id: 'doc-2', title: 'Report 2', source: null } }),
        createMockChunk({ id: 'chunk-3', document: { id: 'doc-3', title: 'Report 3', source: null } }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize all', 'sk-test-key');

      expect(result.summaries).toHaveLength(3);
      expect(mockComplete).toHaveBeenCalledTimes(3);
      expect(result.tokensUsed).toBe(150); // 50 * 3
    });

    it('should group chunks by document before summarizing', async () => {
      mockComplete.mockResolvedValue({
        content: 'Combined summary',
        usage: { totalTokens: 75 },
      });

      const chunks = [
        createMockChunk({ id: 'chunk-1', chunkIndex: 0, document: { id: 'doc-1', title: 'Report', source: null } }),
        createMockChunk({ id: 'chunk-2', chunkIndex: 1, document: { id: 'doc-1', title: 'Report', source: null } }),
        createMockChunk({ id: 'chunk-3', chunkIndex: 2, document: { id: 'doc-1', title: 'Report', source: null } }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize', 'sk-test-key');

      expect(result.summaries).toHaveLength(1); // Only one document
      expect(result.summaries[0].chunkCount).toBe(3); // All three chunks grouped
      expect(mockComplete).toHaveBeenCalledTimes(1); // Only one summarization call
    });

    it('should use highest confidence from chunks for document summary', async () => {
      mockComplete.mockResolvedValue({
        content: 'Summary',
        usage: { totalTokens: 50 },
      });

      const chunks = [
        createMockChunk({ id: 'chunk-1', confidence: 0.7, document: { id: 'doc-1', title: 'Report', source: null } }),
        createMockChunk({ id: 'chunk-2', confidence: 0.9, document: { id: 'doc-1', title: 'Report', source: null } }),
        createMockChunk({ id: 'chunk-3', confidence: 0.6, document: { id: 'doc-1', title: 'Report', source: null } }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize', 'sk-test-key');

      expect(result.summaries[0].confidence).toBe(0.9); // Highest confidence
    });

    it('should preserve document source in summary', async () => {
      mockComplete.mockResolvedValue({
        content: 'Summary',
        usage: { totalTokens: 50 },
      });

      const chunks = [
        createMockChunk({
          document: { id: 'doc-1', title: 'Report', source: 'https://example.com/report.pdf' },
        }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize', 'sk-test-key');

      expect(result.summaries[0].source).toBe('https://example.com/report.pdf');
    });

    it('should sort summaries by confidence descending', async () => {
      let callCount = 0;
      mockComplete.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          content: `Summary ${callCount}`,
          usage: { totalTokens: 50 },
        });
      });

      const chunks = [
        createMockChunk({ id: 'chunk-1', confidence: 0.6, document: { id: 'doc-1', title: 'Low Confidence', source: null } }),
        createMockChunk({ id: 'chunk-2', confidence: 0.9, document: { id: 'doc-2', title: 'High Confidence', source: null } }),
        createMockChunk({ id: 'chunk-3', confidence: 0.75, document: { id: 'doc-3', title: 'Medium Confidence', source: null } }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize', 'sk-test-key');

      // Should be sorted by confidence: high (0.9), medium (0.75), low (0.6)
      expect(result.summaries[0].confidence).toBe(0.9);
      expect(result.summaries[1].confidence).toBe(0.75);
      expect(result.summaries[2].confidence).toBe(0.6);
    });
  });

  // ===========================================================================
  // Empty Input Handling
  // ===========================================================================

  describe('empty input handling', () => {
    it('should return empty result for empty chunks array', async () => {
      const result = await summarizeDocuments([], 'Summarize', 'sk-test-key');

      expect(result.summaries).toHaveLength(0);
      expect(result.originalChunks).toHaveLength(0);
      expect(result.tokensUsed).toBe(0);
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should use first chunk content as fallback on LLM error', async () => {
      mockComplete.mockRejectedValue(new Error('API rate limit exceeded'));

      const chunks = [
        createMockChunk({
          id: 'chunk-1',
          content: 'This is the first chunk content that should be used as fallback.',
          document: { id: 'doc-1', title: 'Report', source: null },
        }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize', 'sk-test-key');

      expect(result.summaries).toHaveLength(1);
      expect(result.summaries[0].summary).toContain('This is the first chunk content');
      expect(result.tokensUsed).toBe(0); // No tokens used on error
    });

    it('should handle partial failures gracefully', async () => {
      let callCount = 0;
      mockComplete.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('API error'));
        }
        return Promise.resolve({
          content: `Summary ${callCount}`,
          usage: { totalTokens: 50 },
        });
      });

      const chunks = [
        createMockChunk({ id: 'chunk-1', document: { id: 'doc-1', title: 'Doc 1', source: null } }),
        createMockChunk({ id: 'chunk-2', document: { id: 'doc-2', title: 'Doc 2', source: null } }),
        createMockChunk({ id: 'chunk-3', document: { id: 'doc-3', title: 'Doc 3', source: null } }),
      ];

      const result = await summarizeDocuments(chunks, 'Summarize', 'sk-test-key');

      expect(result.summaries).toHaveLength(3);
      // One of them should have fallback content
      const fallbackSummary = result.summaries.find(s => s.summary.includes('chunk content'));
      expect(fallbackSummary).toBeDefined();
    });
  });
});
