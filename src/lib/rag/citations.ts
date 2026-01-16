/**
 * Citation Service
 *
 * Maps LLM responses back to source documents.
 * Creates inline citations and source references.
 */

import { RetrievedChunk } from './retrieval';

// =============================================================================
// Types
// =============================================================================

export interface Citation {
  id: number;
  documentId: string;
  documentTitle: string;
  chunkContent: string;
  chunkIndex: number;
  confidence: number;
  source: string | null;
}

export interface CitedResponse {
  text: string;
  citations: Citation[];
  usedChunkIds: string[];
}

export interface CitationContext {
  chunks: RetrievedChunk[];
  citationMap: Map<string, number>;
}

// =============================================================================
// Citation Building
// =============================================================================

/**
 * Create a citation context from retrieved chunks.
 * Maps chunk IDs to citation numbers for reference in prompts.
 */
export function buildCitationContext(chunks: RetrievedChunk[]): CitationContext {
  const citationMap = new Map<string, number>();

  chunks.forEach((chunk, index) => {
    citationMap.set(chunk.id, index + 1);
  });

  return {
    chunks,
    citationMap,
  };
}

/**
 * Format chunks as context for the LLM prompt.
 * Each chunk is labeled with its citation number.
 */
export function formatContextForPrompt(context: CitationContext): string {
  return context.chunks
    .map((chunk, index) => {
      const citationNum = index + 1;
      return `[${citationNum}] (Source: ${chunk.document.title})\n${chunk.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Parse citations from LLM response.
 * Looks for patterns like [1], [2], etc.
 */
export function parseCitations(
  response: string,
  context: CitationContext
): CitedResponse {
  const usedCitationNumbers = new Set<number>();
  // Match both [Citation N] and [N] formats
  const citationRegex = /\[Citation\s*(\d+)\]|\[(\d+)\]/gi;

  let match;
  while ((match = citationRegex.exec(response)) !== null) {
    // match[1] is from [Citation N], match[2] is from [N]
    const num = parseInt(match[1] || match[2], 10);
    if (num > 0 && num <= context.chunks.length) {
      usedCitationNumbers.add(num);
    }
  }

  // Build citation objects for used citations
  const citations: Citation[] = [];
  const usedChunkIds: string[] = [];

  for (const num of usedCitationNumbers) {
    const chunk = context.chunks[num - 1];
    if (chunk) {
      citations.push({
        id: num,
        documentId: chunk.document.id,
        documentTitle: chunk.document.title,
        chunkContent: chunk.content,
        chunkIndex: chunk.chunkIndex,
        confidence: chunk.confidence,
        source: chunk.document.source,
      });
      usedChunkIds.push(chunk.id);
    }
  }

  // Sort citations by their number
  citations.sort((a, b) => a.id - b.id);

  return {
    text: response,
    citations,
    usedChunkIds,
  };
}

/**
 * Add inline citations to response text.
 * Wraps citation markers with additional context.
 */
export function formatCitedResponse(citedResponse: CitedResponse): string {
  // Response already contains [N] markers from LLM
  // Could enhance with links or tooltips in UI
  return citedResponse.text;
}

/**
 * Generate a sources section for the response.
 */
export function formatSourcesSection(citations: Citation[]): string {
  if (citations.length === 0) {
    return '';
  }

  const uniqueDocs = new Map<string, { title: string; source: string | null }>();

  for (const citation of citations) {
    if (!uniqueDocs.has(citation.documentId)) {
      uniqueDocs.set(citation.documentId, {
        title: citation.documentTitle,
        source: citation.source,
      });
    }
  }

  const lines = ['**Sources:**'];
  let sourceNum = 1;

  for (const [, doc] of uniqueDocs) {
    const sourceInfo = doc.source ? ` (${doc.source})` : '';
    lines.push(`${sourceNum}. ${doc.title}${sourceInfo}`);
    sourceNum++;
  }

  return lines.join('\n');
}

// =============================================================================
// Citation Validation
// =============================================================================

/**
 * Check if a response properly uses citations.
 */
export function validateCitations(
  response: string,
  context: CitationContext
): {
  isValid: boolean;
  hasCitations: boolean;
  invalidCitations: number[];
  unusedChunks: number[];
} {
  // Match both [Citation N] and [N] formats
  const citationRegex = /\[Citation\s*(\d+)\]|\[(\d+)\]/gi;
  const usedCitations = new Set<number>();
  const invalidCitations: number[] = [];

  let match;
  while ((match = citationRegex.exec(response)) !== null) {
    // match[1] is from [Citation N], match[2] is from [N]
    const num = parseInt(match[1] || match[2], 10);
    if (num > 0 && num <= context.chunks.length) {
      usedCitations.add(num);
    } else {
      invalidCitations.push(num);
    }
  }

  const unusedChunks: number[] = [];
  for (let i = 1; i <= context.chunks.length; i++) {
    if (!usedCitations.has(i)) {
      unusedChunks.push(i);
    }
  }

  return {
    isValid: invalidCitations.length === 0,
    hasCitations: usedCitations.size > 0,
    invalidCitations,
    unusedChunks,
  };
}

/**
 * Calculate overall confidence for a cited response.
 * Based on the confidence of used citations.
 */
export function calculateOverallConfidence(citations: Citation[]): number {
  if (citations.length === 0) {
    return 0;
  }

  const totalConfidence = citations.reduce((sum, c) => sum + c.confidence, 0);
  return totalConfidence / citations.length;
}
