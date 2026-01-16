/**
 * RAG Module Exports
 *
 * Provides all RAG pipeline functionality:
 * - Document chunking
 * - Embedding generation
 * - Vector retrieval
 * - Citation mapping
 * - Complete RAG service
 */

// Chunker
export {
  chunkText,
  chunkDocument,
  chunkByParagraphs,
  estimateTokens,
  type DocumentChunk,
  type ChunkOptions,
} from './chunker';

// Embeddings
export {
  EmbeddingService,
  createEmbeddingService,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  type EmbeddingResult,
  type BatchEmbeddingResult,
  type EmbeddingConfig,
} from './embeddings';

// Retrieval
export {
  retrieveChunks,
  retrieveWithConfig,
  calculateConfidence,
  getConfidenceLabel,
  rerankChunks,
  type RetrievedChunk,
  type RetrievalResult,
  type RetrievalOptions,
} from './retrieval';

// Citations
export {
  buildCitationContext,
  formatContextForPrompt,
  parseCitations,
  formatCitedResponse,
  formatSourcesSection,
  validateCitations,
  calculateOverallConfidence,
  type Citation,
  type CitedResponse,
  type CitationContext,
} from './citations';

// Summarization
export {
  summarizeDocuments,
  isBroadQuestion,
  buildSummaryContext,
  type DocumentSummary,
  type SummarizationResult,
} from './summarization';

// RAG Service
export {
  RAGService,
  createRAGService,
  type RAGRequest,
  type RAGResponse,
  type RAGStreamCallbacks,
  type RAGStatus,
} from './service';
