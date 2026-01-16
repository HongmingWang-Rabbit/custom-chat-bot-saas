/**
 * OpenAI adapter implementation.
 *
 * Supports:
 * - GPT-4o-mini (default, cheapest), GPT-4o, GPT-4-turbo for completions
 * - text-embedding-3-small (default), text-embedding-3-large for embeddings
 * - Streaming responses
 * - Batch embeddings (native support)
 */

import OpenAI from 'openai';
import {
  BaseLLMAdapter,
  LLMAdapterConfig,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMEmbeddingOptions,
  LLMEmbeddingResponse,
  FinishReason,
} from './adapter';

export class OpenAIAdapter extends BaseLLMAdapter {
  readonly provider = 'openai';
  private client: OpenAI;

  constructor(config: LLMAdapterConfig) {
    super({
      ...config,
      defaultModel: config.defaultModel ?? 'gpt-4o-mini',
      defaultEmbeddingModel: config.defaultEmbeddingModel ?? 'text-embedding-3-small',
    });

    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
  }

  /**
   * Generate a text completion using OpenAI Chat API.
   */
  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 1000,
      stop: options?.stopSequences,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content ?? '',
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  /**
   * Generate a streaming text completion.
   * Yields chunks as they arrive from OpenAI.
   */
  async *streamComplete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    const stream = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 1000,
      stop: options?.stopSequences,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason;

      yield {
        content: delta?.content ?? '',
        finishReason: this.mapFinishReason(finishReason),
      };
    }
  }

  /**
   * Generate an embedding for a single text.
   */
  async embed(
    text: string,
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse> {
    const response = await this.client.embeddings.create({
      model: options?.model ?? this.defaultEmbeddingModel,
      input: text,
    });

    return {
      embedding: response.data[0].embedding,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }

  /**
   * Generate embeddings for multiple texts (batch).
   * Uses OpenAI's native batch embedding support.
   */
  async embedBatch(
    texts: string[],
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse[]> {
    if (texts.length === 0) {
      return [];
    }

    // OpenAI supports batch embedding natively
    const response = await this.client.embeddings.create({
      model: options?.model ?? this.defaultEmbeddingModel,
      input: texts,
    });

    // Calculate per-text usage (approximation)
    const perTextPromptTokens = Math.floor(
      response.usage.prompt_tokens / texts.length
    );
    const perTextTotalTokens = Math.floor(
      response.usage.total_tokens / texts.length
    );

    return response.data.map((item) => ({
      embedding: item.embedding,
      usage: {
        promptTokens: perTextPromptTokens,
        totalTokens: perTextTotalTokens,
      },
    }));
  }

  /**
   * Map OpenAI finish reason to our standard type.
   */
  private mapFinishReason(
    reason: string | null | undefined
  ): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return null;
    }
  }
}
