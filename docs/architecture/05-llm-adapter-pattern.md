# LLM Adapter Pattern

## Overview

The LLM adapter pattern provides a unified interface for interacting with different LLM providers (OpenAI, Anthropic, Azure, etc.). This enables:

1. **Easy provider switching** without code changes
2. **Per-company LLM configuration**
3. **Future-proofing** for new providers
4. **Consistent API** across the application

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Code                         │
│                                                                 │
│   const adapter = createLLMAdapter(company.llm_config);         │
│   const response = await adapter.complete(messages);            │
│                                                                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         LLM Factory                             │
│                                                                 │
│   createLLMAdapter(config) → LLMAdapter                         │
│   createLLMAdapterFromConfig(llmConfig) → LLMAdapter            │
│                                                                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  OpenAIAdapter  │   │ AnthropicAdapter│   │  AzureAdapter   │
│                 │   │   (future)      │   │   (future)      │
│ - complete()    │   │                 │   │                 │
│ - streamComplete│   │                 │   │                 │
│ - embed()       │   │                 │   │                 │
│ - embedBatch()  │   │                 │   │                 │
└────────┬────────┘   └─────────────────┘   └─────────────────┘
         │
         ▼
┌─────────────────┐
│   OpenAI SDK    │
└─────────────────┘
```

---

## Interface Definition

### `LLMAdapter` Interface

```typescript
// src/types/llm.ts

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionOptions {
  model?: string;           // Override default model
  temperature?: number;     // 0.0 - 1.0
  maxTokens?: number;       // Max response tokens
  stopSequences?: string[]; // Stop generation sequences
}

export interface LLMCompletionResponse {
  content: string;
  finishReason: 'stop' | 'length' | 'content_filter' | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMStreamChunk {
  content: string;
  finishReason: 'stop' | 'length' | 'content_filter' | null;
}

export interface LLMEmbeddingOptions {
  model?: string;  // Override default embedding model
}

export interface LLMEmbeddingResponse {
  embedding: number[];  // Vector representation
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

// Core adapter interface
export interface LLMAdapter {
  readonly provider: string;

  // Text completion
  complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResponse>;

  // Streaming completion (returns async generator)
  streamComplete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown>;

  // Single text embedding
  embed(
    text: string,
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse>;

  // Batch embeddings (more efficient)
  embedBatch(
    texts: string[],
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse[]>;
}
```

---

## Base Adapter Class

```typescript
// src/lib/llm/adapter.ts

import {
  LLMAdapter,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMEmbeddingOptions,
  LLMEmbeddingResponse,
} from '@/types/llm';

export abstract class BaseLLMAdapter implements LLMAdapter {
  abstract readonly provider: string;

  protected apiKey: string;
  protected defaultModel: string;
  protected defaultEmbeddingModel: string;

  constructor(config: {
    apiKey: string;
    defaultModel?: string;
    defaultEmbeddingModel?: string;
  }) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
    this.defaultEmbeddingModel = config.defaultEmbeddingModel ?? 'text-embedding-3-small';
  }

  abstract complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResponse>;

  abstract streamComplete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown>;

  abstract embed(
    text: string,
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse>;

  // Default batch implementation - can be overridden
  async embedBatch(
    texts: string[],
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse[]> {
    return Promise.all(texts.map(text => this.embed(text, options)));
  }
}
```

---

## OpenAI Adapter Implementation

```typescript
// src/lib/llm/openai-adapter.ts

import OpenAI from 'openai';
import {
  BaseLLMAdapter,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMEmbeddingOptions,
  LLMEmbeddingResponse,
} from './adapter';

export class OpenAIAdapter extends BaseLLMAdapter {
  readonly provider = 'openai';
  private client: OpenAI;

  constructor(config: {
    apiKey: string;
    defaultModel?: string;
    defaultEmbeddingModel?: string;
  }) {
    super(config);
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

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

  // Override for native batch support
  async embedBatch(
    texts: string[],
    options?: LLMEmbeddingOptions
  ): Promise<LLMEmbeddingResponse[]> {
    const response = await this.client.embeddings.create({
      model: options?.model ?? this.defaultEmbeddingModel,
      input: texts,
    });

    return response.data.map((item) => ({
      embedding: item.embedding,
      usage: {
        promptTokens: Math.floor(response.usage.prompt_tokens / texts.length),
        totalTokens: Math.floor(response.usage.total_tokens / texts.length),
      },
    }));
  }

  private mapFinishReason(
    reason: string | null | undefined
  ): 'stop' | 'length' | 'content_filter' | null {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'content_filter': return 'content_filter';
      default: return null;
    }
  }
}
```

---

## Adapter Factory

```typescript
// src/lib/llm/factory.ts

import { LLMAdapter } from './adapter';
import { OpenAIAdapter } from './openai-adapter';
import { LLMConfig } from '@/types/database';

export type LLMProvider = 'openai' | 'anthropic' | 'azure' | 'custom';

// Registry of available adapters
const adapterRegistry: Map<LLMProvider, new (config: any) => LLMAdapter> = new Map([
  ['openai', OpenAIAdapter],
  // Add new adapters here:
  // ['anthropic', AnthropicAdapter],
  // ['azure', AzureOpenAIAdapter],
]);

/**
 * Create an LLM adapter for a specific provider
 */
export function createLLMAdapter(
  provider: LLMProvider,
  config: {
    apiKey: string;
    defaultModel?: string;
    defaultEmbeddingModel?: string;
  }
): LLMAdapter {
  const AdapterClass = adapterRegistry.get(provider);

  if (!AdapterClass) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return new AdapterClass(config);
}

/**
 * Create adapter from company's LLM config
 */
export function createLLMAdapterFromConfig(llmConfig: LLMConfig): LLMAdapter {
  const apiKey = getApiKeyForProvider(llmConfig.provider);

  return createLLMAdapter(llmConfig.provider as LLMProvider, {
    apiKey,
    defaultModel: llmConfig.model,
    defaultEmbeddingModel: llmConfig.embeddingModel,
  });
}

/**
 * Get API key from environment for provider
 */
function getApiKeyForProvider(provider: string): string {
  const keyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    azure: process.env.AZURE_OPENAI_API_KEY,
  };

  const key = keyMap[provider];

  if (!key) {
    throw new Error(`API key not found for provider: ${provider}. Check environment variables.`);
  }

  return key;
}

/**
 * Register a new adapter (for plugins/extensions)
 */
export function registerLLMAdapter(
  provider: LLMProvider,
  adapterClass: new (config: any) => LLMAdapter
): void {
  adapterRegistry.set(provider, adapterClass);
}

/**
 * Get list of supported providers
 */
export function getSupportedProviders(): LLMProvider[] {
  return Array.from(adapterRegistry.keys());
}
```

---

## Usage Examples

### Basic Usage

```typescript
import { createLLMAdapter } from '@/lib/llm/factory';

// Create adapter directly
const adapter = createLLMAdapter('openai', {
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: 'gpt-4o',
});

// Text completion
const response = await adapter.complete([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is RAG?' }
]);

console.log(response.content);
```

### With Company Config

```typescript
import { createLLMAdapterFromConfig } from '@/lib/llm/factory';
import { createServerClient } from '@/lib/supabase/server';

// Get company config from database
const supabase = createServerClient();
const { data: company } = await supabase
  .from('companies')
  .select('llm_config')
  .eq('slug', 'acme-corp')
  .single();

// Create adapter from config
const adapter = createLLMAdapterFromConfig(company.llm_config);

// Use adapter
const embedding = await adapter.embed('What is the company revenue?');
```

### Streaming Response

```typescript
const adapter = createLLMAdapter('openai', { apiKey: '...' });

const stream = adapter.streamComplete([
  { role: 'user', content: 'Explain machine learning' }
]);

for await (const chunk of stream) {
  process.stdout.write(chunk.content);

  if (chunk.finishReason === 'stop') {
    console.log('\n--- Done ---');
  }
}
```

### Batch Embeddings

```typescript
const adapter = createLLMAdapter('openai', { apiKey: '...' });

const texts = [
  'First document chunk',
  'Second document chunk',
  'Third document chunk',
];

const embeddings = await adapter.embedBatch(texts);

embeddings.forEach((result, i) => {
  console.log(`Chunk ${i}: ${result.embedding.length} dimensions`);
});
```

---

## Adding a New Provider

### Step 1: Create Adapter Class

```typescript
// src/lib/llm/anthropic-adapter.ts

import Anthropic from '@anthropic-ai/sdk';
import { BaseLLMAdapter, ... } from './adapter';

export class AnthropicAdapter extends BaseLLMAdapter {
  readonly provider = 'anthropic';
  private client: Anthropic;

  constructor(config: { apiKey: string; defaultModel?: string }) {
    super({
      ...config,
      defaultModel: config.defaultModel ?? 'claude-3-sonnet-20240229',
      defaultEmbeddingModel: 'voyage-large-2', // Anthropic uses Voyage for embeddings
    });
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  async complete(messages, options) {
    // Map to Anthropic's API format
    const response = await this.client.messages.create({
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 1000,
      messages: this.mapMessages(messages),
    });

    return {
      content: response.content[0].text,
      finishReason: this.mapStopReason(response.stop_reason),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  // ... implement other methods
}
```

### Step 2: Register in Factory

```typescript
// src/lib/llm/factory.ts

import { AnthropicAdapter } from './anthropic-adapter';

const adapterRegistry = new Map([
  ['openai', OpenAIAdapter],
  ['anthropic', AnthropicAdapter],  // Add here
]);
```

### Step 3: Add Environment Variable

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 4: Update Company Config

```sql
UPDATE companies
SET llm_config = jsonb_set(
  llm_config,
  '{provider}',
  '"anthropic"'
)
WHERE slug = 'example-co';
```

---

## Configuration Reference

### OpenAI Models

| Model | Use Case | Context Window |
|-------|----------|----------------|
| `gpt-4o` | Best quality, most expensive | 128K |
| `gpt-4o-mini` | Good balance of cost/quality | 128K |
| `gpt-4-turbo` | High quality | 128K |
| `gpt-3.5-turbo` | Fast, cheap | 16K |

### Embedding Models

| Model | Dimensions | Best For |
|-------|------------|----------|
| `text-embedding-3-small` | 1536 | Cost-effective, good quality |
| `text-embedding-3-large` | 3072 | Highest quality |
| `text-embedding-ada-002` | 1536 | Legacy, widely used |

---

## Error Handling

```typescript
try {
  const response = await adapter.complete(messages);
} catch (error) {
  if (error instanceof OpenAI.APIError) {
    switch (error.status) {
      case 429:
        // Rate limited - implement retry with backoff
        break;
      case 401:
        // Invalid API key
        break;
      case 500:
        // OpenAI server error
        break;
    }
  }
  throw error;
}
```
