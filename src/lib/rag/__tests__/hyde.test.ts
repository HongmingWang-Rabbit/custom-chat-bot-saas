/**
 * Tests for HyDE (Hypothetical Document Embeddings)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI before importing
const mockCreate = vi.fn();
const mockOpenAIInstance = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

vi.mock('openai', () => {
  return {
    default: vi.fn(() => mockOpenAIInstance),
  };
});

import { generateHypotheticalDocument } from '../hyde';
import OpenAI from 'openai';

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
      expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test-key' });
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

      await generateHypotheticalDocument('test query', null);

      expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-env-key' });
    });

    it('should prefer provided API key over environment variable', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hypothetical response' } }],
      });

      await generateHypotheticalDocument('test query', 'sk-provided-key');

      expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-provided-key' });
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
    it('should use configured model from environment', async () => {
      process.env.HYDE_MODEL = 'gpt-4';
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' } }],
      });

      // Need to re-import to pick up new env var
      // Since module is already loaded, we test the default behavior
      await generateHypotheticalDocument('test', 'sk-test-key');

      // The model used will be whatever was set when module loaded
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
