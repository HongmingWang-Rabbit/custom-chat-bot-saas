/**
 * Tests for HyDE (Hypothetical Document Embeddings)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store mock function reference for assertions
const mockCreate = vi.fn();

// Mock OpenAI - must define class inside vi.mock since it's hoisted
vi.mock('openai', () => {
  const MockOpenAI = class {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  };
  return { default: MockOpenAI };
});

import { generateHypotheticalDocument, extractSearchKeywords } from '../hyde';

// =============================================================================
// Test Suite
// =============================================================================

describe('generateHypotheticalDocument', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ===========================================================================
  // Successful Generation
  // ===========================================================================

  describe('successful generation', () => {
    it('should generate hypothetical document from query', async () => {
      const hypotheticalText = 'The company reported strong Q3 earnings with revenue growth of 25%.';
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: hypotheticalText,
            },
          },
        ],
      });

      const result = await generateHypotheticalDocument(
        'What were the Q3 earnings?',
        'sk-test-key'
      );

      expect(result).toBe(hypotheticalText);
      expect(mockCreate).toHaveBeenCalledWith({
        model: expect.any(String),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'What were the Q3 earnings?' }),
        ]),
        max_tokens: 150,
        temperature: 0.3,
      });
    });

    it('should trim whitespace from response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '  Revenue increased by 30%.  \n',
            },
          },
        ],
      });

      const result = await generateHypotheticalDocument('Tell me about revenue', 'sk-test-key');

      expect(result).toBe('Revenue increased by 30%.');
    });

    it('should use environment API key when none provided', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hypothetical response' } }],
      });

      const result = await generateHypotheticalDocument('test query', null);

      expect(result).toBe('Hypothetical response');
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should prefer provided API key over environment variable', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hypothetical response' } }],
      });

      const result = await generateHypotheticalDocument('test query', 'sk-provided-key');

      expect(result).toBe('Hypothetical response');
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Fallback to Original Query
  // ===========================================================================

  describe('fallback to original query', () => {
    it('should return original query when no API key available', async () => {
      delete process.env.OPENAI_API_KEY;

      const result = await generateHypotheticalDocument('What are the risk factors?', null);

      expect(result).toBe('What are the risk factors?');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return original query when response content is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });

    it('should return original query when response content is null', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });

    it('should return original query when choices array is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [],
      });

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });

    it('should return original query when message is undefined', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{}],
      });

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should return original query on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });

    it('should return original query on network error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network error'));

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });

    it('should return original query on invalid API key error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Invalid API key'));

      const result = await generateHypotheticalDocument('test query', 'sk-invalid');

      expect(result).toBe('test query');
    });

    it('should handle non-Error thrown values', async () => {
      mockCreate.mockRejectedValueOnce('String error');

      const result = await generateHypotheticalDocument('test query', 'sk-test-key');

      expect(result).toBe('test query');
    });
  });

  // ===========================================================================
  // System Prompt Verification
  // ===========================================================================

  describe('system prompt', () => {
    it('should include document-style instructions in system prompt', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
      });

      await generateHypotheticalDocument('test', 'sk-test-key');

      const systemMessage = mockCreate.mock.calls[0][0].messages[0];
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toContain('hypothetical document');
      expect(systemMessage.content).toContain('factual');
      expect(systemMessage.content).toContain('company disclosure');
    });

    it('should pass the query as user message', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
      });

      await generateHypotheticalDocument('What is the revenue breakdown?', 'sk-test-key');

      const userMessage = mockCreate.mock.calls[0][0].messages[1];
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe('What is the revenue breakdown?');
    });
  });

  // ===========================================================================
  // Model Configuration
  // ===========================================================================

  describe('model configuration', () => {
    it('should use a model for generation', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
      });

      await generateHypotheticalDocument('test', 'sk-test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(String),
        })
      );
    });

    it('should set max_tokens to 150', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
      });

      await generateHypotheticalDocument('test', 'sk-test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 150,
        })
      );
    });

    it('should set temperature to 0.3 for consistent output', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
      });

      await generateHypotheticalDocument('test', 'sk-test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
        })
      );
    });
  });
});

// =============================================================================
// extractSearchKeywords Tests
// =============================================================================

describe('extractSearchKeywords', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ===========================================================================
  // Successful Extraction
  // ===========================================================================

  describe('successful extraction', () => {
    it('should extract keywords from a query using LLM', async () => {
      const extractedKeywords = 'financial performance revenue profit earnings results fiscal year';
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: extractedKeywords,
            },
          },
        ],
      });

      const result = await extractSearchKeywords(
        'Summarize the financial performance',
        'sk-test-key'
      );

      expect(result).toBe(extractedKeywords);
      expect(mockCreate).toHaveBeenCalledWith({
        model: expect.any(String),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Summarize the financial performance' }),
        ]),
        max_tokens: 50,
        temperature: 0.2,
      });
    });

    it('should clean up response - remove punctuation and normalize spaces', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Revenue, Profit, Earnings!  Multiple  spaces... here.',
            },
          },
        ],
      });

      const result = await extractSearchKeywords('test query', 'sk-test-key');

      expect(result).toBe('revenue profit earnings multiple spaces here');
    });

    it('should convert keywords to lowercase', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'CEO Compensation SALARY Bonus',
            },
          },
        ],
      });

      const result = await extractSearchKeywords('Tell me about CEO pay', 'sk-test-key');

      expect(result).toBe('ceo compensation salary bonus');
    });

    it('should use environment API key when none provided', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'risk factors threats vulnerabilities' } }],
      });

      const result = await extractSearchKeywords('What are the main risks?', null);

      expect(result).toBe('risk factors threats vulnerabilities');
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should prefer provided API key over environment variable', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'keyword1 keyword2' } }],
      });

      const result = await extractSearchKeywords('test query', 'sk-provided-key');

      expect(result).toBe('keyword1 keyword2');
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Fallback to Basic Extraction
  // ===========================================================================

  describe('fallback to basic extraction', () => {
    it('should return basic keywords when no API key available', async () => {
      delete process.env.OPENAI_API_KEY;

      const result = await extractSearchKeywords('What are the risk factors?', null);

      // Basic extraction: words > 2 chars, lowercase
      expect(result).toBe('what are the risk factors');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should filter out short words in basic extraction', async () => {
      delete process.env.OPENAI_API_KEY;

      const result = await extractSearchKeywords('It is a big company', null);

      // 'it', 'is', 'a' are filtered out (≤2 chars)
      expect(result).toBe('big company');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return basic keywords when response content is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      const result = await extractSearchKeywords('Tell me about revenue', 'sk-test-key');

      expect(result).toBe('tell about revenue');
    });

    it('should return basic keywords when response content is null', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const result = await extractSearchKeywords('Tell me about profit', 'sk-test-key');

      expect(result).toBe('tell about profit');
    });

    it('should return basic keywords when choices array is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [],
      });

      const result = await extractSearchKeywords('test query here', 'sk-test-key');

      expect(result).toBe('test query here');
    });

    it('should return basic keywords when message is undefined', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{}],
      });

      const result = await extractSearchKeywords('another test query', 'sk-test-key');

      expect(result).toBe('another test query');
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should return basic keywords on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await extractSearchKeywords('test query about earnings', 'sk-test-key');

      expect(result).toBe('test query about earnings');
    });

    it('should return basic keywords on network error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network error'));

      const result = await extractSearchKeywords('financial performance summary', 'sk-test-key');

      expect(result).toBe('financial performance summary');
    });

    it('should return basic keywords on invalid API key error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Invalid API key'));

      const result = await extractSearchKeywords('company risk assessment', 'sk-invalid');

      expect(result).toBe('company risk assessment');
    });

    it('should handle non-Error thrown values', async () => {
      mockCreate.mockRejectedValueOnce('String error');

      const result = await extractSearchKeywords('revenue breakdown details', 'sk-test-key');

      expect(result).toBe('revenue breakdown details');
    });
  });

  // ===========================================================================
  // System Prompt Verification
  // ===========================================================================

  describe('system prompt', () => {
    it('should include keyword extraction instructions in system prompt', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'keywords here' } }],
      });

      await extractSearchKeywords('test', 'sk-test-key');

      const systemMessage = mockCreate.mock.calls[0][0].messages[0];
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toContain('keyword');
      expect(systemMessage.content).toContain('search');
    });

    it('should include examples in system prompt', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'keywords here' } }],
      });

      await extractSearchKeywords('test', 'sk-test-key');

      const systemMessage = mockCreate.mock.calls[0][0].messages[0];
      expect(systemMessage.content).toContain('financial performance');
      expect(systemMessage.content).toContain('revenue');
    });

    it('should pass the query as user message', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'keywords' } }],
      });

      await extractSearchKeywords('What is the revenue breakdown?', 'sk-test-key');

      const userMessage = mockCreate.mock.calls[0][0].messages[1];
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe('What is the revenue breakdown?');
    });
  });

  // ===========================================================================
  // Model Configuration
  // ===========================================================================

  describe('model configuration', () => {
    it('should set max_tokens to 50 for concise output', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'keywords' } }],
      });

      await extractSearchKeywords('test', 'sk-test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 50,
        })
      );
    });

    it('should set temperature to 0.2 for consistent output', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'keywords' } }],
      });

      await extractSearchKeywords('test', 'sk-test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
        })
      );
    });
  });
});
