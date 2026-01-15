/**
 * Document Chunker
 *
 * Splits documents into overlapping chunks for RAG retrieval.
 * Uses sentence-aware splitting to avoid cutting mid-sentence.
 */

import { RAGConfig } from '@/db/schema/main';

// =============================================================================
// Types
// =============================================================================

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  preserveSentences: boolean;
}

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 500,
  chunkOverlap: 50,
  preserveSentences: true,
};

// =============================================================================
// Chunking Functions
// =============================================================================

/**
 * Split text into overlapping chunks.
 * Optionally preserves sentence boundaries.
 */
export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const { chunkSize, chunkOverlap, preserveSentences } = opts;

  // Normalize whitespace
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  if (!normalizedText) {
    return [];
  }

  // If text is smaller than chunk size, return as single chunk
  if (normalizedText.length <= chunkSize) {
    return [
      {
        content: normalizedText,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: normalizedText.length,
      },
    ];
  }

  const chunks: DocumentChunk[] = [];
  let currentPosition = 0;
  let chunkIndex = 0;

  while (currentPosition < normalizedText.length) {
    let endPosition = Math.min(currentPosition + chunkSize, normalizedText.length);

    // If preserving sentences and not at the end, find sentence boundary
    if (preserveSentences && endPosition < normalizedText.length) {
      endPosition = findSentenceBoundary(normalizedText, currentPosition, endPosition);
    }

    const chunkContent = normalizedText.slice(currentPosition, endPosition).trim();

    if (chunkContent) {
      chunks.push({
        content: chunkContent,
        chunkIndex,
        startOffset: currentPosition,
        endOffset: endPosition,
      });
      chunkIndex++;
    }

    // Move position forward, accounting for overlap
    const stepSize = Math.max(1, endPosition - currentPosition - chunkOverlap);
    currentPosition += stepSize;

    // Prevent infinite loop
    if (currentPosition >= normalizedText.length) break;
  }

  return chunks;
}

/**
 * Find a sentence boundary near the target position.
 * Looks for period, exclamation, or question mark followed by space.
 */
function findSentenceBoundary(
  text: string,
  startPosition: number,
  targetPosition: number
): number {
  // Look backwards from target for sentence ending
  const searchStart = Math.max(startPosition + 100, targetPosition - 100);
  const searchRegion = text.slice(searchStart, targetPosition);

  // Find last sentence-ending punctuation
  const sentenceEndRegex = /[.!?]\s+/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = sentenceEndRegex.exec(searchRegion)) !== null) {
    lastMatch = match;
  }

  if (lastMatch) {
    return searchStart + lastMatch.index + lastMatch[0].length;
  }

  // If no sentence boundary found, look for other natural breaks
  const breakRegex = /[,;:]\s+/g;
  while ((match = breakRegex.exec(searchRegion)) !== null) {
    lastMatch = match;
  }

  if (lastMatch) {
    return searchStart + lastMatch.index + lastMatch[0].length;
  }

  // Fallback: find last space
  const lastSpace = text.lastIndexOf(' ', targetPosition);
  if (lastSpace > startPosition) {
    return lastSpace + 1;
  }

  return targetPosition;
}

/**
 * Create chunks from a document with RAG config.
 */
export function chunkDocument(
  content: string,
  documentId: string,
  ragConfig: Partial<RAGConfig> = {}
): DocumentChunk[] {
  const chunks = chunkText(content, {
    chunkSize: ragConfig.chunkSize ?? 500,
    chunkOverlap: ragConfig.chunkOverlap ?? 50,
    preserveSentences: true,
  });

  // Add document reference to metadata
  return chunks.map((chunk) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      documentId,
    },
  }));
}

/**
 * Estimate token count (rough approximation: ~4 chars per token for English).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split by paragraphs first, then chunk if needed.
 * Useful for maintaining document structure.
 */
export function chunkByParagraphs(
  text: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const { chunkSize, chunkOverlap } = opts;

  // Split by double newlines (paragraphs)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());

  const chunks: DocumentChunk[] = [];
  let currentChunk = '';
  let chunkIndex = 0;
  let startOffset = 0;

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    // If adding this paragraph exceeds chunk size
    if (currentChunk && currentChunk.length + trimmedParagraph.length + 1 > chunkSize) {
      // Save current chunk
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex,
        startOffset,
        endOffset: startOffset + currentChunk.length,
      });
      chunkIndex++;

      // Start new chunk with overlap
      const overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
      currentChunk = currentChunk.slice(overlapStart) + ' ' + trimmedParagraph;
      startOffset = startOffset + overlapStart;
    } else {
      // Add paragraph to current chunk
      currentChunk = currentChunk ? currentChunk + ' ' + trimmedParagraph : trimmedParagraph;
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex,
      startOffset,
      endOffset: startOffset + currentChunk.length,
    });
  }

  return chunks;
}
