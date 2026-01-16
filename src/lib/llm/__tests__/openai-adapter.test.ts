/**
 * Tests for OpenAI Adapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store mock references for tests
const mockChatCreate = vi.fn();
const mockEmbeddingsCreate = vi.fn();
const mockConstructorCalls: Array<{ apiKey: string; baseURL?: string }> = [];

// Mock OpenAI before importing adapter - use actual class definition
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockChatCreate } };
      embeddings = { create: mockEmbeddingsCreate };
      constructor(config: { apiKey: string; baseURL?: string }) {
        mockConstructorCalls.push(config);
      }
    },
  };
});

import { OpenAIAdapter } from '../openai-adapter';

// =============================================================================
// Test Setup
// =============================================================================

const createMockOpenAI = () => {
  // Reset mocks for each test
  mockChatCreate.mockReset();
  mockEmbeddingsCreate.mockReset();
  mockConstructorCalls.length = 0;

  return { mockCreate: mockChatCreate, mockEmbeddingsCreate, constructorCalls: mockConstructorCalls };
};

// =============================================================================
// Constructor Tests
// =============================================================================

describe('OpenAIAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with default models', () => {
      const { constructorCalls } = createMockOpenAI();

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });

      expect(adapter.provider).toBe('openai');
      expect(constructorCalls).toContainEqual({
        apiKey: 'test-key',
        baseURL: undefined,
      });
    });

    it('should accept custom default model', () => {
      createMockOpenAI();

      const adapter = new OpenAIAdapter({
        apiKey: 'test-key',
        defaultModel: 'gpt-4o',
      });

      expect(adapter.provider).toBe('openai');
    });

    it('should accept custom base URL', () => {
      const { constructorCalls } = createMockOpenAI();

      new OpenAIAdapter({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });

      expect(constructorCalls).toContainEqual({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com',
      });
    });
  });

  // ===========================================================================
  // complete() Tests
  // ===========================================================================

  describe('complete', () => {
    it('should call OpenAI chat completions API', async () => {
      const { mockCreate } = createMockOpenAI();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const result = await adapter.complete([
        { role: 'user', content: 'Hi' },
      ]);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.3,
        max_tokens: 1000,
        stop: undefined,
      });
      expect(result.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage.totalTokens).toBe(15);
    });

    it('should use custom options when provided', async () => {
      const { mockCreate } = createMockOpenAI();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      await adapter.complete(
        [{ role: 'user', content: 'Test' }],
        {
          model: 'gpt-4o',
          temperature: 0.7,
          maxTokens: 500,
          stopSequences: ['END'],
        }
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.7,
        max_tokens: 500,
        stop: ['END'],
      });
    });

    it('should handle null content in response', async () => {
      const { mockCreate } = createMockOpenAI();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const result = await adapter.complete([{ role: 'user', content: 'Hi' }]);

      expect(result.content).toBe('');
    });

    it('should map finish reasons correctly', async () => {
      const { mockCreate } = createMockOpenAI();

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });

      // Test 'length' finish reason
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Text' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
      });
      let result = await adapter.complete([{ role: 'user', content: 'Hi' }]);
      expect(result.finishReason).toBe('length');

      // Test 'content_filter' finish reason
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });
      result = await adapter.complete([{ role: 'user', content: 'Hi' }]);
      expect(result.finishReason).toBe('content_filter');

      // Test unknown finish reason
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Text' }, finish_reason: 'unknown' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      result = await adapter.complete([{ role: 'user', content: 'Hi' }]);
      expect(result.finishReason).toBeNull();
    });
  });

  // ===========================================================================
  // streamComplete() Tests
  // ===========================================================================

  describe('streamComplete', () => {
    it('should yield chunks from stream', async () => {
      const { mockCreate } = createMockOpenAI();

      // Create an async iterable mock
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] };
          yield { choices: [{ delta: { content: ' World' }, finish_reason: null }] };
          yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] };
        },
      };
      mockCreate.mockResolvedValue(mockStream);

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const chunks: string[] = [];

      for await (const chunk of adapter.streamComplete([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk.content);
      }

      expect(chunks).toEqual(['Hello', ' World', '']);
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
    });
  });

  // ===========================================================================
  // embed() Tests
  // ===========================================================================

  describe('embed', () => {
    it('should generate embedding for single text', async () => {
      const { mockEmbeddingsCreate } = createMockOpenAI();
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const result = await adapter.embed('test text');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.usage.totalTokens).toBe(5);
    });

    it('should use custom embedding model when provided', async () => {
      const { mockEmbeddingsCreate } = createMockOpenAI();
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }],
        usage: { prompt_tokens: 3, total_tokens: 3 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      await adapter.embed('test', { model: 'text-embedding-3-large' });

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        input: 'test',
      });
    });
  });

  // ===========================================================================
  // embedBatch() Tests
  // ===========================================================================

  describe('embedBatch', () => {
    it('should return empty array for empty input', async () => {
      createMockOpenAI();

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const result = await adapter.embedBatch([]);

      expect(result).toEqual([]);
    });

    it('should generate embeddings for multiple texts', async () => {
      const { mockEmbeddingsCreate } = createMockOpenAI();
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
        ],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const result = await adapter.embedBatch(['text1', 'text2']);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['text1', 'text2'],
      });
      expect(result).toHaveLength(2);
      expect(result[0].embedding).toEqual([0.1, 0.2]);
      expect(result[1].embedding).toEqual([0.3, 0.4]);
    });

    it('should calculate per-text usage', async () => {
      const { mockEmbeddingsCreate } = createMockOpenAI();
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { embedding: [0.1] },
          { embedding: [0.2] },
          { embedding: [0.3] },
        ],
        usage: { prompt_tokens: 30, total_tokens: 30 },
      });

      const adapter = new OpenAIAdapter({ apiKey: 'test-key' });
      const result = await adapter.embedBatch(['a', 'b', 'c']);

      expect(result[0].usage.totalTokens).toBe(10);
      expect(result[1].usage.totalTokens).toBe(10);
      expect(result[2].usage.totalTokens).toBe(10);
    });
  });
});
