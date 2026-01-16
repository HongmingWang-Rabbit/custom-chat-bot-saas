/**
 * HyDE (Hypothetical Document Embeddings)
 *
 * Improves retrieval by generating a hypothetical answer to the query,
 * then searching for documents similar to that answer.
 *
 * This bridges the gap between question-style queries and statement-style documents.
 */

import OpenAI from 'openai';
import { logger } from '@/lib/logger';

const log = logger.child({ layer: 'rag', service: 'HyDE' });

// Model for HyDE generation (configurable via env, defaults to fast/cheap model)
const HYDE_MODEL = process.env.HYDE_MODEL || 'gpt-4o-mini';

/**
 * Generate a hypothetical document/answer for a query.
 * This is used to improve embedding similarity with actual documents.
 */
export async function generateHypotheticalDocument(
  query: string,
  apiKey: string | null
): Promise<string> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    // Fall back to query if no API key
    return query;
  }

  const client = new OpenAI({ apiKey: key });

  try {
    const response = await client.chat.completions.create({
      model: HYDE_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that generates hypothetical document excerpts.
Given a question, write a short passage (2-3 sentences) that would answer it.
Write in a factual, document-like style as if from a company disclosure or report.
Do NOT include phrases like "According to" or "The document states".
Just write the content directly as if it's from the source document.`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    const hypothetical = response.choices[0]?.message?.content?.trim();

    if (hypothetical) {
      log.debug(
        { event: 'hyde_generated', queryLength: query.length, hydeLength: hypothetical.length },
        'Generated hypothetical document'
      );
      return hypothetical;
    }

    return query;
  } catch (error) {
    log.warn(
      { event: 'hyde_error', error: error instanceof Error ? error.message : String(error) },
      'Failed to generate hypothetical document, using original query'
    );
    return query;
  }
}
