/**
 * Retrieval Service
 *
 * Performs vector similarity search on document chunks using pgvector.
 * Returns relevant chunks with confidence scores for RAG.
 */

import { sql } from 'drizzle-orm';
import { TenantDatabase } from '@/db';
import { RAGConfig } from '@/db/schema/main';
import { createEmbeddingService } from './embeddings';
import { generateHypotheticalDocument } from './hyde';
import { logger } from '@/lib/logger';

const log = logger.child({ layer: 'rag', service: 'Retrieval' });

// Enable HyDE for better query-document alignment (configurable via env)
const HYDE_ENABLED = process.env.HYDE_ENABLED !== 'false';

// RRF (Reciprocal Rank Fusion) constant - typically 60
// Higher values reduce the impact of rank differences
const RRF_K = 60;

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

  // Use HyDE to generate a hypothetical document for better retrieval
  let textToEmbed = query;
  if (HYDE_ENABLED) {
    textToEmbed = await generateHypotheticalDocument(query, apiKey);
    log.info({ event: 'hyde_text', original: query, hypothetical: textToEmbed.substring(0, 100) }, 'Using HyDE');
  }

  // Generate embedding for the query (or hypothetical document if HyDE enabled)
  const embeddingService = createEmbeddingService(apiKey);
  const { embedding, tokens } = await embeddingService.embed(textToEmbed);

  // Build the vector similarity query using pgvector
  const embeddingStr = `[${embedding.join(',')}]`;

  // Extract keywords from original query for keyword search
  const keywords = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .join(' | '); // OR search

  // Query for similar chunks using HYBRID SEARCH with RRF
  // Combines: vector similarity + keyword matching using Reciprocal Rank Fusion
  interface ChunkRow {
    chunk_id: string;
    content: string;
    chunk_index: number;
    vector_score: number;
    vector_rank: number;
    keyword_score: number;
    keyword_rank: number | null;
    rrf_score: number;
    document_id: string;
    document_title: string;
    document_source: string | null;
  }

  // Debug: Check if we can query the database at all
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM document_chunks WHERE embedding IS NOT NULL
  `);
  log.info({ event: 'retrieval_debug', chunkCount: countResult[0]?.count }, 'Total chunks with embeddings');

  // Hybrid search using Reciprocal Rank Fusion (RRF)
  // RRF_score = 1/(k + rank_vector) + 1/(k + rank_keyword)
  // This properly combines rankings regardless of score magnitudes
  const results = await db.execute(sql`
    WITH vector_search AS (
      SELECT
        dc.id as chunk_id,
        dc.content,
        dc.chunk_index,
        1 - (dc.embedding <=> ${embeddingStr}::vector) as vector_score,
        ROW_NUMBER() OVER (ORDER BY dc.embedding <=> ${embeddingStr}::vector) as vector_rank,
        d.id as document_id,
        d.title as document_title,
        d.url as document_source
      FROM document_chunks dc
      JOIN documents d ON dc.doc_id = d.id
      WHERE d.status = 'ready'
        AND dc.embedding IS NOT NULL
      ${opts.documentIds?.length
        ? sql`AND d.id IN (${sql.join(opts.documentIds.map(id => sql`${id}`), sql`, `)})`
        : sql``
      }
    ),
    keyword_search AS (
      SELECT
        dc.id as chunk_id,
        ts_rank_cd(
          to_tsvector('english', dc.content || ' ' || COALESCE(d.title, '')),
          to_tsquery('english', ${keywords})
        ) as keyword_score,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', dc.content || ' ' || COALESCE(d.title, '')),
            to_tsquery('english', ${keywords})
          ) DESC
        ) as keyword_rank
      FROM document_chunks dc
      JOIN documents d ON dc.doc_id = d.id
      WHERE d.status = 'ready'
        AND to_tsvector('english', dc.content || ' ' || COALESCE(d.title, '')) @@ to_tsquery('english', ${keywords})
    )
    SELECT
      v.chunk_id,
      v.content,
      v.chunk_index,
      v.vector_score,
      v.vector_rank,
      COALESCE(k.keyword_score, 0) as keyword_score,
      k.keyword_rank,
      -- RRF formula: 1/(k + rank)
      -- If no keyword match, only use vector rank
      (1.0 / (${RRF_K} + v.vector_rank)) +
      COALESCE(1.0 / (${RRF_K} + k.keyword_rank), 0) as rrf_score,
      v.document_id,
      v.document_title,
      v.document_source
    FROM vector_search v
    LEFT JOIN keyword_search k ON v.chunk_id = k.chunk_id
    ORDER BY rrf_score DESC
    LIMIT ${opts.topK * 2}
  `);

  log.info({ event: 'retrieval_raw_results', rowCount: results.length }, 'Raw hybrid search results');

  // Convert to RetrievedChunk format with confidence scores
  // postgres-js driver returns rows directly as an array-like result
  const rows: ChunkRow[] = Array.from(results as unknown as ChunkRow[]);

  // Parse numeric fields (postgres-js returns strings)
  const parsedRows = rows.map(r => ({
    ...r,
    vector_score: Number(r.vector_score),
    vector_rank: Number(r.vector_rank),
    keyword_score: Number(r.keyword_score),
    keyword_rank: r.keyword_rank !== null ? Number(r.keyword_rank) : null,
    rrf_score: Number(r.rrf_score),
  }));

  // Debug: Log scores before filtering
  if (parsedRows.length > 0) {
    log.info({
      event: 'retrieval_scores',
      scores: parsedRows.slice(0, 5).map(r => ({
        title: r.document_title,
        vectorScore: r.vector_score.toFixed(3),
        vectorRank: r.vector_rank,
        keywordScore: r.keyword_score.toFixed(3),
        keywordRank: r.keyword_rank,
        rrfScore: r.rrf_score.toFixed(4),
      })),
      threshold: opts.confidenceThreshold,
    }, 'Hybrid search scores (RRF)');
  }

  // Calculate normalized score for filtering and display
  // Map RRF score to 0-1 range: max possible is ~0.033 (rank 1 in both), min is ~0.016 (rank 1 in one)
  const maxRrf = 2 / (RRF_K + 1); // ~0.0328 for k=60
  const normalizeRrf = (rrf: number) => Math.min(1, rrf / maxRrf);

  const chunks: RetrievedChunk[] = parsedRows
    .filter((row) => {
      const normalizedScore = normalizeRrf(row.rrf_score);
      // Include if normalized RRF score meets threshold
      return normalizedScore >= opts.confidenceThreshold;
    })
    .slice(0, opts.topK)
    .map((row) => {
      const normalizedScore = normalizeRrf(row.rrf_score);
      // Confidence based on rank quality
      let confidence = row.vector_rank <= 3 ? 0.8 : row.vector_rank <= 10 ? 0.6 : 0.4;
      // Boost if keyword match exists
      if (row.keyword_rank !== null) {
        confidence += row.keyword_rank <= 3 ? 0.15 : 0.05;
      }
      return {
        id: row.chunk_id,
        content: row.content,
        chunkIndex: row.chunk_index,
        similarity: normalizedScore, // Normalized RRF score for display
        confidence: Math.min(1, confidence),
        document: {
          id: row.document_id,
          title: row.document_title,
          source: row.document_source,
        },
      };
    });

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
