/**
 * Base LLM adapter class.
 *
 * Provides the interface that all LLM provider adapters must implement.
 * Enables easy switching between OpenAI, Anthropic, Azure, etc.
 */

import {
  LLMAdapter,
  LLMAdapterConfig,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMEmbeddingOptions,
  LLMEmbeddingResponse,
  FinishReason,
} from '@/types/llm';

/**
 * Abstract base class for LLM adapters.
 *
 * Subclasses must implement:
 * - complete()
 * - streamComplete()
 * - embed()
 *
 * embedBatch() has a default implementation that can be overridden.
 */
export abstract class BaseLLMAdapter implements LLMAdapter {
  abstract readonly provider: string;

  protected apiKey: string;
  protected defaultModel: string;
  protected defaultEmbeddingModel: string;
  protected baseUrl?: string;

  constructor(config: LLMAdapterConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
    this.defaultEmbeddingModel = config.defaultEmbeddingModel ?? 'text-embedding-3-small';
    this.baseUrl = config.baseUrl;
  }

  /**
   * Generate a text completion.
   */
  abstract complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResponse>;

  /**
   * Generate a streaming text completion.
   */
  abstract streamComplete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown>;

  /**
   * Generate an embedding for a single text.
   */
  abstract embed(
    text: string,
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse>;

  /**
   * Generate embeddings for multiple texts.
   * Default implementation calls embed() for each text.
   * Override for providers with native batch support.
   */
  async embedBatch(
    texts: string[],
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse[]> {
    return Promise.all(texts.map(text => this.embed(text, options)));
  }
}

// Re-export types for convenience
export type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMEmbeddingOptions,
  LLMEmbeddingResponse,
  FinishReason,
};
