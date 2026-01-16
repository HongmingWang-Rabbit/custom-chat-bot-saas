/**
 * Query Expansion Module
 *
 * Contains LLM-powered query expansion techniques:
 * - HyDE (Hypothetical Document Embeddings) for vector search
 * - Keyword extraction for full-text search
 *
 * These bridge the gap between user queries and document content.
 */

import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import {
  HYDE_MODEL,
  HYDE_MAX_TOKENS,
  HYDE_TEMPERATURE,
  KEYWORD_EXTRACTION_MAX_TOKENS,
  KEYWORD_EXTRACTION_TEMPERATURE,
} from './config';

const log = logger.child({ layer: 'rag', service: 'HyDE' });

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
      max_tokens: HYDE_MAX_TOKENS,
      temperature: HYDE_TEMPERATURE,
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

/**
 * Extract search keywords from a user query using LLM.
 * This improves keyword search by identifying key terms, entities, and relevant synonyms.
 *
 * @example
 * Input: "Summarize the financial performance"
 * Output: "financial performance revenue profit earnings results fiscal"
 */
export async function extractSearchKeywords(
  query: string,
  apiKey: string | null
): Promise<string> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    // Fall back to simple extraction if no API key
    return extractBasicKeywords(query);
  }

  const client = new OpenAI({ apiKey: key });

  try {
    const response = await client.chat.completions.create({
      model: HYDE_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a search keyword extractor for a company document search system.
Given a user question, extract the most relevant search keywords that would match company disclosures, financial reports, and business documents.

Rules:
1. Extract key nouns, entities, and domain-specific terms
2. Include common synonyms and related terms (e.g., "revenue" → also include "sales", "income")
3. Remove filler words like "summarize", "explain", "tell me about", "what is"
4. Keep the output concise: 5-15 keywords maximum
5. Return ONLY space-separated keywords, no punctuation or explanations

Examples:
- "Summarize the financial performance" → "financial performance revenue profit earnings results fiscal year"
- "What are the main risks?" → "risk factors risks challenges threats exposure vulnerabilities"
- "Tell me about the CEO's compensation" → "CEO compensation executive salary bonus stock options pay"`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
      max_tokens: KEYWORD_EXTRACTION_MAX_TOKENS,
      temperature: KEYWORD_EXTRACTION_TEMPERATURE,
    });

    const keywords = response.choices[0]?.message?.content?.trim();

    if (keywords) {
      // Clean up: ensure only alphanumeric and spaces
      const cleaned = keywords
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      log.debug(
        { event: 'keywords_extracted', original: query, keywords: cleaned },
        'Extracted search keywords'
      );
      return cleaned;
    }

    return extractBasicKeywords(query);
  } catch (error) {
    log.warn(
      { event: 'keyword_extraction_error', error: error instanceof Error ? error.message : String(error) },
      'Failed to extract keywords, using basic extraction'
    );
    return extractBasicKeywords(query);
  }
}

/**
 * Basic keyword extraction (fallback when LLM is unavailable).
 * Simply extracts words longer than 2 characters.
 */
function extractBasicKeywords(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .join(' ');
}
