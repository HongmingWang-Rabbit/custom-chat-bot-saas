/**
 * LLM adapter interface types.
 *
 * These types define the contract for LLM provider adapters,
 * enabling easy switching between OpenAI, Anthropic, Azure, etc.
 */

/**
 * Message in a chat conversation.
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for text completion.
 */
export interface LLMCompletionOptions {
  model?: string;           // Override default model
  temperature?: number;     // 0.0 - 1.0 (lower = more deterministic)
  maxTokens?: number;       // Max response tokens
  stopSequences?: string[]; // Stop generation sequences
}

/**
 * Response from text completion.
 */
export interface LLMCompletionResponse {
  content: string;
  finishReason: FinishReason;
  usage: TokenUsage;
}

/**
 * Chunk from streaming completion.
 */
export interface LLMStreamChunk {
  content: string;
  finishReason: FinishReason;
  /** Usage stats (typically only on final chunk) */
  usage?: TokenUsage;
}

/**
 * Reason for completion stopping.
 */
export type FinishReason = 'stop' | 'length' | 'content_filter' | null;

/**
 * Token usage statistics.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Options for embedding generation.
 */
export interface LLMEmbeddingOptions {
  model?: string;  // Override default embedding model
}

/**
 * Response from embedding generation.
 */
export interface LLMEmbeddingResponse {
  embedding: number[];  // Vector representation
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Core LLM adapter interface.
 *
 * All provider adapters must implement this interface.
 */
export interface LLMAdapter {
  /** Provider name (e.g., 'openai', 'anthropic') */
  readonly provider: string;

  /**
   * Generate a text completion.
   *
   * @param messages - Conversation messages
   * @param options - Generation options
   * @returns Completion response with content and usage
   */
  complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResponse>;

  /**
   * Generate a streaming text completion.
   *
   * @param messages - Conversation messages
   * @param options - Generation options
   * @yields Chunks of the response as they're generated
   */
  streamComplete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown>;

  /**
   * Generate an embedding for a single text.
   *
   * @param text - Text to embed
   * @param options - Embedding options
   * @returns Embedding vector and usage
   */
  embed(
    text: string,
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse>;

  /**
   * Generate embeddings for multiple texts (batch).
   * More efficient than calling embed() multiple times.
   *
   * @param texts - Texts to embed
   * @param options - Embedding options
   * @returns Array of embedding responses
   */
  embedBatch(
    texts: string[],
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse[]>;
}

/**
 * Configuration for creating an LLM adapter.
 */
export interface LLMAdapterConfig {
  apiKey: string;
  defaultModel?: string;
  defaultEmbeddingModel?: string;
  baseUrl?: string;  // For custom endpoints
}
