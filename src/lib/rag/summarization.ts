/**
 * Document Summarization Service
 *
 * Provides document-level summaries for broad questions.
 * Instead of sending raw chunks, summarizes each document first
 * for more coherent and comprehensive answers.
 */

import { RetrievedChunk } from './retrieval';
import { createLLMAdapterFromConfig } from '@/lib/llm';
import { logger } from '@/lib/logger';
import {
  SUMMARIZATION_ENABLED,
  SUMMARY_MAX_TOKENS,
  SUMMARY_TEMPERATURE,
  SUMMARY_MAX_CONCURRENT,
} from './config';

// =============================================================================
// Concurrency Limiter
// =============================================================================

/**
 * Simple concurrency limiter to prevent overwhelming the LLM API.
 * Limits the number of concurrent async operations.
 */
function createConcurrencyLimiter(maxConcurrent: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (queue.length > 0 && activeCount < maxConcurrent) {
      activeCount++;
      const next = queue.shift();
      next?.();
    }
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const run = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          activeCount--;
          runNext();
        }
      };

      if (activeCount < maxConcurrent) {
        activeCount++;
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

const log = logger.child({ layer: 'rag', service: 'Summarization' });

// =============================================================================
// Types
// =============================================================================

export interface DocumentSummary {
  documentId: string;
  documentTitle: string;
  summary: string;
  chunkCount: number;
  confidence: number;
  source: string | null;
}

export interface SummarizationResult {
  summaries: DocumentSummary[];
  originalChunks: RetrievedChunk[];
  tokensUsed: number;
}

// =============================================================================
// Summarization Functions
// =============================================================================

/**
 * Group chunks by document.
 */
function groupChunksByDocument(chunks: RetrievedChunk[]): Map<string, RetrievedChunk[]> {
  const grouped = new Map<string, RetrievedChunk[]>();

  for (const chunk of chunks) {
    const docId = chunk.document.id;
    const docChunks = grouped.get(docId) || [];
    docChunks.push(chunk);
    grouped.set(docId, docChunks);
  }

  // Sort chunks within each document by chunk index
  for (const [docId, docChunks] of grouped) {
    grouped.set(docId, docChunks.sort((a, b) => a.chunkIndex - b.chunkIndex));
  }

  return grouped;
}

/**
 * Generate a summary for a single document from its chunks.
 */
async function summarizeDocument(
  documentTitle: string,
  chunks: RetrievedChunk[],
  query: string,
  llmApiKey: string | null
): Promise<{ summary: string; tokensUsed: number }> {
  const llm = createLLMAdapterFromConfig('openai', llmApiKey);

  // Combine chunk contents
  const combinedContent = chunks
    .map((c, i) => `[Section ${i + 1}]\n${c.content}`)
    .join('\n\n');

  const systemPrompt = `You are a document summarizer. Create a concise summary of the document content that is relevant to the user's question. Focus on key facts, figures, and conclusions. Be factual and objective.`;

  const userPrompt = `Question: ${query}

Document: ${documentTitle}

Content:
${combinedContent}

Provide a concise summary (2-4 sentences) of the relevant information from this document that helps answer the question. Focus on specific facts, numbers, and key points.`;

  try {
    const response = await llm.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: SUMMARY_MAX_TOKENS,
        temperature: SUMMARY_TEMPERATURE,
      }
    );

    return {
      summary: response.content,
      tokensUsed: response.usage.totalTokens,
    };
  } catch (error) {
    log.error({
      event: 'summarization_error',
      document: documentTitle,
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to summarize document');

    // Fallback: use first chunk as summary
    return {
      summary: chunks[0]?.content.slice(0, 500) || 'Unable to summarize document.',
      tokensUsed: 0,
    };
  }
}

/**
 * Summarize all retrieved documents.
 * Generates concise summaries for each document to provide better context.
 */
export async function summarizeDocuments(
  chunks: RetrievedChunk[],
  query: string,
  llmApiKey: string | null
): Promise<SummarizationResult> {
  if (!SUMMARIZATION_ENABLED || chunks.length === 0) {
    return {
      summaries: [],
      originalChunks: chunks,
      tokensUsed: 0,
    };
  }

  const grouped = groupChunksByDocument(chunks);
  const summaries: DocumentSummary[] = [];
  let totalTokens = 0;

  log.info({
    event: 'summarization_start',
    documentCount: grouped.size,
    totalChunks: chunks.length,
    maxConcurrent: SUMMARY_MAX_CONCURRENT,
  }, 'Starting document summarization');

  // Create concurrency limiter to avoid overwhelming LLM API
  const limit = createConcurrencyLimiter(SUMMARY_MAX_CONCURRENT);

  // Summarize each document with concurrency limiting
  const summaryPromises = Array.from(grouped.entries()).map(
    ([docId, docChunks]) => limit(async () => {
      const firstChunk = docChunks[0];
      const { summary, tokensUsed } = await summarizeDocument(
        firstChunk.document.title,
        docChunks,
        query,
        llmApiKey
      );

      return {
        documentId: docId,
        documentTitle: firstChunk.document.title,
        summary,
        chunkCount: docChunks.length,
        confidence: Math.max(...docChunks.map(c => c.confidence)),
        source: firstChunk.document.source,
        tokensUsed,
      };
    })
  );

  const results = await Promise.all(summaryPromises);

  for (const result of results) {
    summaries.push({
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      summary: result.summary,
      chunkCount: result.chunkCount,
      confidence: result.confidence,
      source: result.source,
    });
    totalTokens += result.tokensUsed;
  }

  // Sort by confidence
  summaries.sort((a, b) => b.confidence - a.confidence);

  log.info({
    event: 'summarization_complete',
    documentCount: summaries.length,
    totalTokens,
  }, 'Document summarization completed');

  return {
    summaries,
    originalChunks: chunks,
    tokensUsed: totalTokens,
  };
}

/**
 * Detect if a question is broad (benefits from summarization)
 * vs specific (better answered with raw chunks).
 *
 * Broad questions are those that ask for overviews, comparisons, or trends
 * rather than specific data points. These benefit from document-level summaries
 * to provide more coherent and comprehensive answers.
 *
 * @param query - The user's question
 * @returns true if the question is broad and should use summarization
 *
 * @example
 * // Returns true - asks for overview
 * isBroadQuestion("Summarize the annual report")
 *
 * @example
 * // Returns true - asks about trends
 * isBroadQuestion("How has revenue changed year over year?")
 *
 * @example
 * // Returns false - specific question
 * isBroadQuestion("What is the CEO's name?")
 *
 * @example
 * // Returns false - specific data point
 * isBroadQuestion("What was the Q3 revenue?")
 */
export function isBroadQuestion(query: string): boolean {
  const broadPatterns = [
    /summarize/i,
    /overview/i,
    /what.*overall/i,
    /tell me about/i,
    /explain.*company/i,
    /how.*perform/i,
    /financial.*performance/i,
    /key.*point/i,
    /main.*takeaway/i,
    /high.*level/i,
    /in general/i,
    /compare/i,
    /trend/i,
    /across.*year/i,
    /year.*over.*year/i,
  ];

  return broadPatterns.some(pattern => pattern.test(query));
}

/**
 * Build context for LLM from document summaries.
 */
export function buildSummaryContext(summaries: DocumentSummary[]): string {
  return summaries
    .map((s, i) => `[Document ${i + 1}: ${s.documentTitle}]
Summary: ${s.summary}
(Based on ${s.chunkCount} sections, confidence: ${Math.round(s.confidence * 100)}%)`)
    .join('\n\n---\n\n');
}
