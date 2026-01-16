/**
 * Embedding Service
 *
 * Generates vector embeddings for text using OpenAI's API.
 * Uses text-embedding-3-large (3072 dimensions) for better retrieval quality.
 */

import OpenAI from 'openai';

// =============================================================================
// Types
// =============================================================================

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
  batchSize: number;
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';
export const EMBEDDING_DIMENSIONS = 3072;
const MAX_BATCH_SIZE = 100; // OpenAI limit

// =============================================================================
// Embedding Service Class
// =============================================================================

export class EmbeddingService {
  private client: OpenAI;
  private model: string;
  private dimensions: number;
  private batchSize: number;

  constructor(
    apiKey: string,
    config: Partial<EmbeddingConfig> = {}
  ) {
    this.client = new OpenAI({ apiKey });
    this.model = config.model ?? DEFAULT_EMBEDDING_MODEL;
    this.dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
    this.batchSize = Math.min(config.batchSize ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE);
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    if (!text.trim()) {
      throw new Error('Cannot generate embedding for empty text');
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });

    return {
      embedding: response.data[0].embedding,
      tokens: response.usage.total_tokens,
    };
  }

  /**
   * Generate embeddings for multiple texts in batches.
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    const validTexts = texts.filter((t) => t.trim());

    if (validTexts.length === 0) {
      return { embeddings: [], totalTokens: 0 };
    }

    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    // Process in batches
    for (let i = 0; i < validTexts.length; i += this.batchSize) {
      const batch = validTexts.slice(i, i + this.batchSize);

      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });

      // Ensure embeddings are in the same order as input
      const sortedData = response.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sortedData.map((d) => d.embedding));
      totalTokens += response.usage.total_tokens;
    }

    return {
      embeddings: allEmbeddings,
      totalTokens,
    };
  }

  /**
   * Get the embedding model being used.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the embedding dimensions.
   */
  getDimensions(): number {
    return this.dimensions;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an EmbeddingService with optional tenant-specific API key.
 * Falls back to OPENAI_API_KEY environment variable.
 */
export function createEmbeddingService(
  apiKey?: string | null,
  config?: Partial<EmbeddingConfig>
): EmbeddingService {
  const key = apiKey ?? process.env.OPENAI_API_KEY;

  if (!key) {
    throw new Error('No OpenAI API key provided and OPENAI_API_KEY not set');
  }

  return new EmbeddingService(key, config);
}
