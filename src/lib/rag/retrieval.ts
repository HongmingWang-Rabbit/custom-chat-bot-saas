/**
 * Retrieval Service
 *
 * Performs vector similarity search on document chunks using pgvector.
 * Returns relevant chunks with confidence scores for RAG.
 */

import { sql } from 'drizzle-orm';
import { TenantDatabase } from '@/db';
import { documentChunks, documents } from '@/db/schema/tenant';
import { RAGConfig } from '@/db/schema/main';
import { createEmbeddingService } from './embeddings';

// =============================================================================
// Types
// =============================================================================

export interface RetrievedChunk {
  id: string;
  content: string;
  chunkIndex: number;
  similarity: number;
  confidence: number;
  document: {
    id: string;
    title: string;
    source: string | null;
  };
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  query: string;
  queryEmbeddingTokens: number;
}

export interface RetrievalOptions {
  topK: number;
  confidenceThreshold: number;
  documentIds?: string[];
}

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_RETRIEVAL_OPTIONS: RetrievalOptions = {
  topK: 5,
  confidenceThreshold: 0.6,
};

// =============================================================================
// Retrieval Functions
// =============================================================================

/**
 * Retrieve relevant document chunks for a query.
 */
export async function retrieveChunks(
  db: TenantDatabase,
  query: string,
  apiKey: string | null,
  options: Partial<RetrievalOptions> = {}
): Promise<RetrievalResult> {
  const opts = { ...DEFAULT_RETRIEVAL_OPTIONS, ...options };

  // Generate query embedding
  const embeddingService = createEmbeddingService(apiKey);
  const { embedding, tokens } = await embeddingService.embed(query);

  // Build the vector similarity query using pgvector
  const embeddingStr = `[${embedding.join(',')}]`;

  // Query for similar chunks
  // Using cosine distance: 1 - (a <=> b) gives similarity
  interface ChunkRow {
    chunk_id: string;
    content: string;
    chunk_index: number;
    similarity: number;
    document_id: string;
    document_title: string;
    document_source: string | null;
  }

  const results = await db.execute(sql`
    SELECT
      dc.id as chunk_id,
      dc.content,
      dc.chunk_index,
      1 - (dc.embedding <=> ${embeddingStr}::vector) as similarity,
      d.id as document_id,
      d.title as document_title,
      d.source as document_source
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE d.status = 'ready'
    ${opts.documentIds?.length
      ? sql`AND d.id IN (${sql.join(opts.documentIds.map(id => sql`${id}`), sql`, `)})`
      : sql``
    }
    ORDER BY dc.embedding <=> ${embeddingStr}::vector
    LIMIT ${opts.topK}
  `);

  // Convert to RetrievedChunk format with confidence scores
  // The execute result is an array-like RowList
  const rows = results as unknown as ChunkRow[];
  const chunks: RetrievedChunk[] = rows
    .filter((row) => row.similarity >= opts.confidenceThreshold)
    .map((row) => ({
      id: row.chunk_id,
      content: row.content,
      chunkIndex: row.chunk_index,
      similarity: row.similarity,
      confidence: calculateConfidence(row.similarity),
      document: {
        id: row.document_id,
        title: row.document_title,
        source: row.document_source,
      },
    }));

  return {
    chunks,
    query,
    queryEmbeddingTokens: tokens,
  };
}

/**
 * Retrieve chunks using RAG config from tenant settings.
 */
export async function retrieveWithConfig(
  db: TenantDatabase,
  query: string,
  apiKey: string | null,
  ragConfig: Partial<RAGConfig> = {}
): Promise<RetrievalResult> {
  return retrieveChunks(db, query, apiKey, {
    topK: ragConfig.topK ?? 5,
    confidenceThreshold: ragConfig.confidenceThreshold ?? 0.6,
  });
}

// =============================================================================
// Confidence Scoring
// =============================================================================

/**
 * Convert similarity score to confidence level.
 * Maps cosine similarity (0-1) to a confidence percentage.
 */
export function calculateConfidence(similarity: number): number {
  // Similarity is already 0-1 from cosine distance
  // Apply a slight boost for higher similarities
  if (similarity >= 0.9) return 0.95 + (similarity - 0.9) * 0.5;
  if (similarity >= 0.8) return 0.85 + (similarity - 0.8) * 1.0;
  if (similarity >= 0.7) return 0.70 + (similarity - 0.7) * 1.5;
  return Math.max(0, similarity * 0.9);
}

/**
 * Get confidence level label.
 */
export function getConfidenceLabel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

// =============================================================================
// Reranking (optional enhancement)
// =============================================================================

/**
 * Simple reranking based on multiple factors.
 * Can be enhanced with cross-encoder models later.
 */
export function rerankChunks(
  chunks: RetrievedChunk[],
  query: string
): RetrievedChunk[] {
  return chunks
    .map((chunk) => {
      let boost = 0;

      // Boost if query terms appear in chunk
      const queryTerms = query.toLowerCase().split(/\s+/);
      const chunkLower = chunk.content.toLowerCase();

      for (const term of queryTerms) {
        if (term.length > 2 && chunkLower.includes(term)) {
          boost += 0.02;
        }
      }

      // Boost first chunks slightly (usually more relevant)
      if (chunk.chunkIndex === 0) {
        boost += 0.01;
      }

      return {
        ...chunk,
        confidence: Math.min(1, chunk.confidence + boost),
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}
