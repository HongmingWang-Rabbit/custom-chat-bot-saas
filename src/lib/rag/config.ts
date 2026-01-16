/**
 * RAG Configuration Constants
 *
 * Centralized configuration for RAG pipeline parameters.
 * These values are used as defaults when tenant-specific config is not provided.
 */

// =============================================================================
// Retrieval Configuration
// =============================================================================

/**
 * Default number of chunks to retrieve from vector search.
 * Higher values increase chance of getting chunks from multiple documents.
 */
export const DEFAULT_TOP_K = 25;

/**
 * Default confidence threshold for filtering retrieved chunks.
 *
 * For hybrid RRF scoring, threshold is on normalized 0-1 scale where:
 * - 1.0 = rank #1 in BOTH vector AND keyword search
 * - 0.5 = rank #1 in vector search only (no keyword match)
 * - 0.3 = ~rank #40 in vector only, or distributed across both
 *
 * Lowered to 0.25 to include more documents while still filtering noise.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.25;

/**
 * Maximum chunks per document to ensure diversity across documents.
 * Prevents a single highly-relevant document from dominating all results.
 */
export const MAX_CHUNKS_PER_DOCUMENT = 5;

/**
 * Minimum number of documents to include in retrieval.
 * Two-pass retrieval ensures at least this many documents are represented.
 */
export const MIN_DOCUMENTS_TO_INCLUDE = 4;

/**
 * Number of chunks to retrieve in first pass for document discovery.
 * Should be higher than DEFAULT_TOP_K to find all relevant documents.
 */
export const FIRST_PASS_TOP_K = 50;

/**
 * Enable two-pass retrieval for better document coverage.
 * First pass finds relevant documents, second pass gets best chunks from each.
 */
export const TWO_PASS_RETRIEVAL_ENABLED = true;

/**
 * Enable document summarization for broad questions.
 * When enabled, documents are summarized before answering.
 */
export const SUMMARIZATION_ENABLED = true;

/**
 * Max tokens for document summary generation.
 */
export const SUMMARY_MAX_TOKENS = 300;

/**
 * Temperature for summary generation.
 */
export const SUMMARY_TEMPERATURE = 0.3;

/**
 * RRF (Reciprocal Rank Fusion) constant.
 * Higher values reduce the impact of rank differences.
 * Standard value is 60 (from original RRF paper).
 */
export const RRF_K = 60;

// =============================================================================
// Confidence Scoring Configuration
// =============================================================================

/**
 * Vector rank threshold for high confidence (rank <= this = high).
 */
export const CONFIDENCE_RANK_HIGH_THRESHOLD = 3;

/**
 * Vector rank threshold for medium confidence (rank <= this = medium).
 */
export const CONFIDENCE_RANK_MEDIUM_THRESHOLD = 10;

/**
 * Confidence score for high-ranked results.
 */
export const CONFIDENCE_SCORE_HIGH = 0.8;

/**
 * Confidence score for medium-ranked results.
 */
export const CONFIDENCE_SCORE_MEDIUM = 0.6;

/**
 * Confidence score for low-ranked results.
 */
export const CONFIDENCE_SCORE_LOW = 0.4;

/**
 * Keyword rank threshold for high boost.
 */
export const KEYWORD_RANK_HIGH_THRESHOLD = 3;

/**
 * Confidence boost for high keyword rank.
 */
export const KEYWORD_BOOST_HIGH = 0.15;

/**
 * Confidence boost for low keyword rank.
 */
export const KEYWORD_BOOST_LOW = 0.05;

// =============================================================================
// Similarity-to-Confidence Mapping
// =============================================================================

/**
 * Similarity threshold for very high confidence tier.
 */
export const SIMILARITY_TIER_VERY_HIGH = 0.9;

/**
 * Similarity threshold for high confidence tier.
 */
export const SIMILARITY_TIER_HIGH = 0.8;

/**
 * Similarity threshold for medium confidence tier.
 */
export const SIMILARITY_TIER_MEDIUM = 0.7;

/**
 * Base confidence for very high similarity tier.
 */
export const SIMILARITY_CONFIDENCE_VERY_HIGH_BASE = 0.95;

/**
 * Multiplier for very high similarity tier.
 */
export const SIMILARITY_CONFIDENCE_VERY_HIGH_MULT = 0.5;

/**
 * Base confidence for high similarity tier.
 */
export const SIMILARITY_CONFIDENCE_HIGH_BASE = 0.85;

/**
 * Multiplier for high similarity tier.
 */
export const SIMILARITY_CONFIDENCE_HIGH_MULT = 1.0;

/**
 * Base confidence for medium similarity tier.
 */
export const SIMILARITY_CONFIDENCE_MEDIUM_BASE = 0.70;

/**
 * Multiplier for medium similarity tier.
 */
export const SIMILARITY_CONFIDENCE_MEDIUM_MULT = 1.5;

/**
 * Multiplier for low similarity tier (below medium threshold).
 */
export const SIMILARITY_CONFIDENCE_LOW_MULT = 0.9;

/**
 * Threshold for "high" confidence label.
 */
export const CONFIDENCE_LABEL_HIGH_THRESHOLD = 0.8;

/**
 * Threshold for "medium" confidence label.
 */
export const CONFIDENCE_LABEL_MEDIUM_THRESHOLD = 0.6;

// =============================================================================
// Reranking Configuration
// =============================================================================

/**
 * Confidence boost per matching query term in chunk content.
 */
export const RERANK_TERM_BOOST = 0.02;

/**
 * Confidence boost for first chunk in a document.
 */
export const RERANK_FIRST_CHUNK_BOOST = 0.01;

/**
 * Minimum term length to consider for reranking boost.
 */
export const RERANK_MIN_TERM_LENGTH = 2;

// =============================================================================
// Chunking Configuration
// =============================================================================

/**
 * Default chunk size in characters for document splitting.
 */
export const DEFAULT_CHUNK_SIZE = 500;

/**
 * Default overlap between chunks in characters.
 * Helps maintain context across chunk boundaries.
 */
export const DEFAULT_CHUNK_OVERLAP = 50;

// =============================================================================
// LLM Configuration
// =============================================================================

/**
 * Default max tokens for RAG response generation.
 */
export const DEFAULT_RAG_MAX_TOKENS = 1024;

/**
 * Default temperature for RAG response generation.
 * Lower values = more focused/deterministic responses.
 */
export const DEFAULT_RAG_TEMPERATURE = 0.3;

/**
 * Model for HyDE and keyword extraction (fast/cheap model).
 */
export const HYDE_MODEL = process.env.HYDE_MODEL || 'gpt-4o-mini';

/**
 * Max tokens for HyDE hypothetical document generation.
 */
export const HYDE_MAX_TOKENS = 150;

/**
 * Temperature for HyDE generation.
 */
export const HYDE_TEMPERATURE = 0.3;

/**
 * Max tokens for keyword extraction.
 */
export const KEYWORD_EXTRACTION_MAX_TOKENS = 50;

/**
 * Temperature for keyword extraction.
 */
export const KEYWORD_EXTRACTION_TEMPERATURE = 0.2;

// =============================================================================
// Feature Flags (from environment)
// =============================================================================

/**
 * Enable HyDE for better query-document alignment.
 * Disable with HYDE_ENABLED=false.
 */
export const HYDE_ENABLED = process.env.HYDE_ENABLED !== 'false';

/**
 * Enable LLM-based keyword extraction for better keyword search.
 * Disable with KEYWORD_EXTRACTION_ENABLED=false for faster queries.
 */
export const KEYWORD_EXTRACTION_ENABLED = process.env.KEYWORD_EXTRACTION_ENABLED !== 'false';

/**
 * Enable verbose debug logging for retrieval diagnostics.
 * Enable with RETRIEVAL_DEBUG=true (disable in production for performance).
 */
export const RETRIEVAL_DEBUG = process.env.RETRIEVAL_DEBUG === 'true';

// =============================================================================
// Conversational Query Patterns
// =============================================================================

/**
 * Pattern to match greeting queries (hi, hello, hey, etc.).
 * These skip RAG retrieval and return a friendly response.
 */
export const GREETING_PATTERNS = /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings|what's up|sup)[\s!?.]*$/i;

/**
 * Pattern to match help/capability queries.
 * These skip RAG retrieval and explain the assistant's capabilities.
 */
export const HELP_PATTERNS = /^(help|what can you do|how can you help|what are you|who are you|how does this work|what is this)[\s!?.]*$/i;

// =============================================================================
// Composite Default Config
// =============================================================================

/**
 * Default RAG configuration object.
 * Used when tenant-specific config is not provided.
 */
export const DEFAULT_RAG_CONFIG = {
  topK: DEFAULT_TOP_K,
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  chunkSize: DEFAULT_CHUNK_SIZE,
  chunkOverlap: DEFAULT_CHUNK_OVERLAP,
} as const;
