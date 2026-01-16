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
import { generateHypotheticalDocument, extractSearchKeywords } from './hyde';
import { logger } from '@/lib/logger';
import {
  DEFAULT_TOP_K,
  DEFAULT_CONFIDENCE_THRESHOLD,
  MAX_CHUNKS_PER_DOCUMENT,
  MIN_DOCUMENTS_TO_INCLUDE,
  FIRST_PASS_TOP_K,
  TWO_PASS_RETRIEVAL_ENABLED,
  RRF_K,
  HYDE_ENABLED,
  KEYWORD_EXTRACTION_ENABLED,
  RETRIEVAL_DEBUG,
  CONFIDENCE_RANK_HIGH_THRESHOLD,
  CONFIDENCE_RANK_MEDIUM_THRESHOLD,
  CONFIDENCE_SCORE_HIGH,
  CONFIDENCE_SCORE_MEDIUM,
  CONFIDENCE_SCORE_LOW,
  KEYWORD_RANK_HIGH_THRESHOLD,
  KEYWORD_BOOST_HIGH,
  KEYWORD_BOOST_LOW,
  RERANK_TERM_BOOST,
  RERANK_FIRST_CHUNK_BOOST,
  RERANK_MIN_TERM_LENGTH,
  SIMILARITY_TIER_VERY_HIGH,
  SIMILARITY_TIER_HIGH,
  SIMILARITY_TIER_MEDIUM,
  SIMILARITY_CONFIDENCE_VERY_HIGH_BASE,
  SIMILARITY_CONFIDENCE_VERY_HIGH_MULT,
  SIMILARITY_CONFIDENCE_HIGH_BASE,
  SIMILARITY_CONFIDENCE_HIGH_MULT,
  SIMILARITY_CONFIDENCE_MEDIUM_BASE,
  SIMILARITY_CONFIDENCE_MEDIUM_MULT,
  SIMILARITY_CONFIDENCE_LOW_MULT,
  CONFIDENCE_LABEL_HIGH_THRESHOLD,
  CONFIDENCE_LABEL_MEDIUM_THRESHOLD,
} from './config';

const log = logger.child({ layer: 'rag', service: 'Retrieval' });

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
  topK: DEFAULT_TOP_K,
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
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

  // Run HyDE+embedding and keyword extraction in parallel
  // These are independent operations that both call LLM APIs
  const embeddingService = createEmbeddingService(apiKey);

  // Task 1: HyDE generation → Embedding (sequential, embedding depends on HyDE)
  const embeddingTask = async () => {
    let textToEmbed = query;
    if (HYDE_ENABLED) {
      textToEmbed = await generateHypotheticalDocument(query, apiKey);
      log.info({ event: 'hyde_text', original: query, hypothetical: textToEmbed.substring(0, 100) }, 'Using HyDE');
    }
    return embeddingService.embed(textToEmbed);
  };

  // Task 2: Keyword extraction (independent of HyDE/embedding)
  const keywordTask = async () => {
    if (KEYWORD_EXTRACTION_ENABLED) {
      const extracted = await extractSearchKeywords(query, apiKey);
      log.info({ event: 'keywords_extracted', original: query, keywords: extracted }, 'Using LLM-extracted keywords');
      return extracted;
    }
    // Fallback: simple word extraction
    const basic = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .join(' ');
    log.debug({ event: 'keywords_basic', original: query, keywords: basic }, 'Using basic keyword extraction');
    return basic;
  };

  // Run both tasks in parallel
  const [{ embedding, tokens }, keywords] = await Promise.all([
    embeddingTask(),
    keywordTask(),
  ]);

  // Build the vector similarity query using pgvector
  // Format: '[0.1,0.2,...]' with quotes for PostgreSQL to parse as vector literal
  const embeddingStr = `'[${embedding.join(',')}]'`;

  // Check if we have valid keywords for hybrid search
  const hasKeywords = keywords.trim().length > 0;

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

  // Check if we have chunks with embeddings (always needed)
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM document_chunks WHERE embedding IS NOT NULL
  `);
  const chunkCount = countResult[0]?.count;

  // If no chunks with embeddings, return early
  if (!chunkCount || Number(chunkCount) === 0) {
    log.warn({ event: 'retrieval_no_chunks' }, 'No document chunks with embeddings found');
    return {
      chunks: [],
      query,
      queryEmbeddingTokens: tokens,
    };
  }

  // Run diagnostic queries only when RETRIEVAL_DEBUG is enabled (for performance)
  if (RETRIEVAL_DEBUG) {
    log.info({ event: 'retrieval_debug', chunkCount, embeddingDim: embedding.length }, 'Total chunks with embeddings');

    try {
      // Test: self-distance (should work if pgvector is enabled)
      await db.execute(sql`
        SELECT embedding <=> embedding as self_dist
        FROM document_chunks
        WHERE embedding IS NOT NULL
        LIMIT 1
      `);
      log.info({ event: 'pgvector_test', success: true }, 'pgvector extension working');

      // Check stored embedding dimension
      const dimCheck = await db.execute(sql`
        SELECT vector_dims(embedding) as dim
        FROM document_chunks
        WHERE embedding IS NOT NULL
        LIMIT 1
      `);
      const storedDim = dimCheck[0]?.dim;
      log.info({
        event: 'dimension_check',
        storedDimension: storedDim,
        queryDimension: embedding.length,
        match: storedDim == embedding.length,
      }, 'Checking embedding dimensions');

      if (storedDim && Number(storedDim) !== embedding.length) {
        log.error({
          event: 'dimension_mismatch',
          storedDimension: storedDim,
          queryDimension: embedding.length,
        }, 'Embedding dimension mismatch!');
        throw new Error(`Embedding dimension mismatch: stored=${storedDim}, query=${embedding.length}`);
      }

      // Log embedding string format (first 100 chars)
      log.info({
        event: 'embedding_format',
        embeddingStrStart: embeddingStr.substring(0, 100),
        embeddingStrEnd: embeddingStr.substring(embeddingStr.length - 50),
        length: embeddingStr.length,
      }, 'Embedding string format');

      // Test: try the actual embedding to catch dimension mismatches
      const embeddingTest = await db.execute(sql`
        SELECT dc.id, dc.embedding <=> ${sql.raw(embeddingStr)} as dist
        FROM document_chunks dc
        WHERE dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> ${sql.raw(embeddingStr)}
        LIMIT 1
      `);
      log.info({ event: 'embedding_test', success: true, result: embeddingTest[0] }, 'Embedding query working');
    } catch (pgvectorError) {
      log.error({
        event: 'pgvector_error',
        error: pgvectorError instanceof Error ? pgvectorError.message : String(pgvectorError),
        embeddingStrStart: embeddingStr.substring(0, 100),
      }, 'pgvector or embedding query failed');
      throw new Error('Vector search is not available. Please check embedding dimensions match.');
    }
  }

  // Use hybrid search (RRF) when keywords exist, vector-only search otherwise
  let results;

  try {
    if (hasKeywords) {
      // Hybrid search using Reciprocal Rank Fusion (RRF)
      // RRF_score = 1/(k + rank_vector) + 1/(k + rank_keyword)
      // This properly combines rankings regardless of score magnitudes
      log.info({ event: 'retrieval_mode', mode: 'hybrid', keywords }, 'Using hybrid search with keywords');
      results = await db.execute(sql`
        WITH vector_search AS (
          SELECT
            dc.id as chunk_id,
            dc.content,
            dc.chunk_index,
            1 - (dc.embedding <=> ${sql.raw(embeddingStr)}) as vector_score,
            ROW_NUMBER() OVER (ORDER BY dc.embedding <=> ${sql.raw(embeddingStr)}) as vector_rank,
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
              websearch_to_tsquery('english', ${keywords})
            ) as keyword_score,
            ROW_NUMBER() OVER (
              ORDER BY ts_rank_cd(
                to_tsvector('english', dc.content || ' ' || COALESCE(d.title, '')),
                websearch_to_tsquery('english', ${keywords})
              ) DESC
            ) as keyword_rank
          FROM document_chunks dc
          JOIN documents d ON dc.doc_id = d.id
          WHERE d.status = 'ready'
            AND to_tsvector('english', dc.content || ' ' || COALESCE(d.title, '')) @@ websearch_to_tsquery('english', ${keywords})
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
    } else {
      // Vector-only search when no valid keywords extracted
      log.info({ event: 'retrieval_mode', mode: 'vector_only', reason: 'no_keywords' }, 'Using vector-only search');
      results = await db.execute(sql`
        WITH vector_search AS (
          SELECT
            dc.id as chunk_id,
            dc.content,
            dc.chunk_index,
            1 - (dc.embedding <=> ${sql.raw(embeddingStr)}) as vector_score,
            ROW_NUMBER() OVER (ORDER BY dc.embedding <=> ${sql.raw(embeddingStr)}) as vector_rank,
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
        )
        SELECT
          chunk_id,
          content,
          chunk_index,
          vector_score,
          vector_rank,
          0 as keyword_score,
          NULL as keyword_rank,
          (1.0 / (${RRF_K} + vector_rank)) as rrf_score,
          document_id,
          document_title,
          document_source
        FROM vector_search
        ORDER BY vector_rank
        LIMIT ${opts.topK * 2}
      `);
    }
  } catch (dbError) {
    // Log the full error for debugging but return a sanitized message
    // Truncate error message to avoid logging huge embedding vectors
    const errorMsg = dbError instanceof Error ? dbError.message : String(dbError);
    const truncatedError = errorMsg.length > 500 ? errorMsg.substring(0, 500) + '...[truncated]' : errorMsg;

    log.error({
      event: 'retrieval_db_error',
      error: truncatedError,
      stack: dbError instanceof Error ? dbError.stack?.substring(0, 500) : undefined,
      query,
      hasKeywords,
    }, 'Database query failed during retrieval');

    // Throw a sanitized error that doesn't expose SQL details or embeddings
    throw new Error('Failed to search documents. Please try again.');
  }

  log.info({ event: 'retrieval_raw_results', rowCount: results.length }, 'Raw hybrid search results');

  // Convert to RetrievedChunk format with confidence scores
  // postgres-js driver returns rows directly as an array-like result
  // Type guard to validate row structure from database
  const isChunkRow = (row: unknown): row is ChunkRow => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Record<string, unknown>;
    return 'chunk_id' in r && 'content' in r && 'vector_score' in r;
  };

  const rows: ChunkRow[] = Array.from(results as Iterable<unknown>).filter(isChunkRow);

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

  // Helper to convert row to chunk
  const rowToChunk = (row: typeof parsedRows[0]): RetrievedChunk => {
    const normalizedScore = normalizeRrf(row.rrf_score);
    let confidence = row.vector_rank <= CONFIDENCE_RANK_HIGH_THRESHOLD
      ? CONFIDENCE_SCORE_HIGH
      : row.vector_rank <= CONFIDENCE_RANK_MEDIUM_THRESHOLD
        ? CONFIDENCE_SCORE_MEDIUM
        : CONFIDENCE_SCORE_LOW;
    if (row.keyword_rank !== null) {
      confidence += row.keyword_rank <= KEYWORD_RANK_HIGH_THRESHOLD
        ? KEYWORD_BOOST_HIGH
        : KEYWORD_BOOST_LOW;
    }
    return {
      id: row.chunk_id,
      content: row.content,
      chunkIndex: row.chunk_index,
      similarity: normalizedScore,
      confidence: Math.min(1, confidence),
      document: {
        id: row.document_id,
        title: row.document_title,
        source: row.document_source,
      },
    };
  };

  let chunks: RetrievedChunk[];

  if (TWO_PASS_RETRIEVAL_ENABLED) {
    // TWO-PASS RETRIEVAL: Ensures coverage across all relevant documents
    // Pass 1: Discover all relevant documents from top results
    const documentBestChunks = new Map<string, typeof parsedRows[0][]>();

    for (const row of parsedRows) {
      const normalizedScore = normalizeRrf(row.rrf_score);
      if (normalizedScore < opts.confidenceThreshold) continue;

      const docChunks = documentBestChunks.get(row.document_id) || [];
      docChunks.push(row);
      documentBestChunks.set(row.document_id, docChunks);
    }

    // Pass 2: Select best chunks from each document, ensuring minimum document coverage
    const selectedChunks: typeof parsedRows[0][] = [];
    const sortedDocs = Array.from(documentBestChunks.entries())
      .map(([docId, docChunks]) => ({
        docId,
        chunks: docChunks.sort((a, b) => b.rrf_score - a.rrf_score),
        bestScore: Math.max(...docChunks.map(c => c.rrf_score)),
      }))
      .sort((a, b) => b.bestScore - a.bestScore);

    // First, ensure minimum document coverage (at least 1 chunk from top N docs)
    const docsToInclude = Math.min(MIN_DOCUMENTS_TO_INCLUDE, sortedDocs.length);
    for (let i = 0; i < docsToInclude; i++) {
      const doc = sortedDocs[i];
      // Add at least one chunk from each important document
      if (doc.chunks.length > 0) {
        selectedChunks.push(doc.chunks[0]);
      }
    }

    // Then fill remaining slots with best chunks across all docs (with per-doc limit)
    const documentChunkCounts = new Map<string, number>();
    for (const chunk of selectedChunks) {
      const count = documentChunkCounts.get(chunk.document_id) || 0;
      documentChunkCounts.set(chunk.document_id, count + 1);
    }

    for (const doc of sortedDocs) {
      for (const chunk of doc.chunks) {
        if (selectedChunks.length >= opts.topK) break;

        const docCount = documentChunkCounts.get(chunk.document_id) || 0;
        if (docCount >= MAX_CHUNKS_PER_DOCUMENT) continue;

        // Skip if already added
        if (selectedChunks.some(c => c.chunk_id === chunk.chunk_id)) continue;

        selectedChunks.push(chunk);
        documentChunkCounts.set(chunk.document_id, docCount + 1);
      }
      if (selectedChunks.length >= opts.topK) break;
    }

    // Sort by score and convert to chunks
    chunks = selectedChunks
      .sort((a, b) => b.rrf_score - a.rrf_score)
      .map(rowToChunk);

    log.info({
      event: 'retrieval_two_pass',
      totalCandidates: parsedRows.length,
      uniqueDocuments: documentBestChunks.size,
      selectedChunks: chunks.length,
      documentsIncluded: new Set(chunks.map(c => c.document.id)).size,
      minDocsTarget: MIN_DOCUMENTS_TO_INCLUDE,
    }, 'Two-pass retrieval completed');

  } else {
    // SINGLE-PASS: Simple diversity limiting
    const documentChunkCounts = new Map<string, number>();
    const diverseRows = parsedRows.filter((row) => {
      const normalizedScore = normalizeRrf(row.rrf_score);
      if (normalizedScore < opts.confidenceThreshold) return false;

      const docCount = documentChunkCounts.get(row.document_id) || 0;
      if (docCount >= MAX_CHUNKS_PER_DOCUMENT) return false;

      documentChunkCounts.set(row.document_id, docCount + 1);
      return true;
    });

    log.info({
      event: 'retrieval_diversity',
      totalCandidates: parsedRows.length,
      afterDiversity: diverseRows.length,
      uniqueDocuments: documentChunkCounts.size,
    }, 'Applied document diversity');

    chunks = diverseRows.slice(0, opts.topK).map(rowToChunk);
  }

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
    topK: ragConfig.topK ?? DEFAULT_TOP_K,
    confidenceThreshold: ragConfig.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
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
  if (similarity >= SIMILARITY_TIER_VERY_HIGH) {
    return SIMILARITY_CONFIDENCE_VERY_HIGH_BASE +
      (similarity - SIMILARITY_TIER_VERY_HIGH) * SIMILARITY_CONFIDENCE_VERY_HIGH_MULT;
  }
  if (similarity >= SIMILARITY_TIER_HIGH) {
    return SIMILARITY_CONFIDENCE_HIGH_BASE +
      (similarity - SIMILARITY_TIER_HIGH) * SIMILARITY_CONFIDENCE_HIGH_MULT;
  }
  if (similarity >= SIMILARITY_TIER_MEDIUM) {
    return SIMILARITY_CONFIDENCE_MEDIUM_BASE +
      (similarity - SIMILARITY_TIER_MEDIUM) * SIMILARITY_CONFIDENCE_MEDIUM_MULT;
  }
  return Math.max(0, similarity * SIMILARITY_CONFIDENCE_LOW_MULT);
}

/**
 * Get confidence level label.
 */
export function getConfidenceLabel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= CONFIDENCE_LABEL_HIGH_THRESHOLD) return 'high';
  if (confidence >= CONFIDENCE_LABEL_MEDIUM_THRESHOLD) return 'medium';
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
        if (term.length > RERANK_MIN_TERM_LENGTH && chunkLower.includes(term)) {
          boost += RERANK_TERM_BOOST;
        }
      }

      // Boost first chunks slightly (usually more relevant)
      if (chunk.chunkIndex === 0) {
        boost += RERANK_FIRST_CHUNK_BOOST;
      }

      return {
        ...chunk,
        confidence: Math.min(1, chunk.confidence + boost),
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}
