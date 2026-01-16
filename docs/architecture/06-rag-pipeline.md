# RAG Pipeline

## Overview

The Retrieval-Augmented Generation (RAG) pipeline combines vector similarity search with LLM generation to produce grounded, cited answers.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              RAG Pipeline                                    │
│                                                                              │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐   │
│  │ Question│───►│  Embedding  │───►│  Retrieval  │───►│  Confidence     │   │
│  │         │    │  Generation │    │  (pgvector) │    │  Check          │   │
│  └─────────┘    └─────────────┘    └─────────────┘    └────────┬────────┘   │
│                                                                 │            │
│                                    ┌────────────────────────────┼─────────┐  │
│                                    │                            │         │  │
│                                    ▼                            ▼         │  │
│                          ┌─────────────────┐          ┌─────────────────┐ │  │
│                          │ Low Confidence  │          │ High Confidence │ │  │
│                          │ Fallback        │          │ Continue        │ │  │
│                          └────────┬────────┘          └────────┬────────┘ │  │
│                                   │                            │          │  │
│                                   ▼                            ▼          │  │
│                          ┌─────────────────┐          ┌─────────────────┐ │  │
│                          │ Return Safe     │          │ Build RAG       │ │  │
│                          │ Response        │          │ Prompt          │ │  │
│                          └─────────────────┘          └────────┬────────┘ │  │
│                                                                │          │  │
│                                                                ▼          │  │
│                                                       ┌─────────────────┐ │  │
│                                                       │ LLM Generation  │ │  │
│                                                       │ (Streaming)     │ │  │
│                                                       └────────┬────────┘ │  │
│                                                                │          │  │
│                                                                ▼          │  │
│                                                       ┌─────────────────┐ │  │
│                                                       │ Citation        │ │  │
│                                                       │ Extraction      │ │  │
│                                                       └────────┬────────┘ │  │
│                                                                │          │  │
│                                                                ▼          │  │
│                                                       ┌─────────────────┐ │  │
│                                                       │ Response        │ │  │
│                                                       │ + Citations     │ │  │
│                                                       └─────────────────┘ │  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Document Ingestion

### Chunking Strategy

Documents are split into overlapping chunks for better retrieval:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Original Document                               │
│                                                                         │
│  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do       │
│   eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim   │
│   ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut    │
│   aliquip ex ea commodo consequat..."                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Chunked Output                                 │
│                                                                         │
│  Chunk 0: "Lorem ipsum dolor sit amet, consectetur adipiscing elit."   │
│           ◄─────────── 500 chars ───────────►                          │
│                                                                         │
│  Chunk 1: "...consectetur adipiscing elit. Sed do eiusmod tempor..."   │
│           ◄── 50 char overlap ──►◄────── 450 new chars ──────►         │
│                                                                         │
│  Chunk 2: "...tempor incididunt ut labore et dolore magna aliqua..."   │
│           ◄── 50 char overlap ──►◄────── 450 new chars ──────►         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Configuration:**
```typescript
interface ChunkConfig {
  chunkSize: 500,      // Target characters per chunk
  chunkOverlap: 50,    // Overlap between chunks
}
```

### Chunking Implementation

```typescript
// src/lib/rag/chunker.ts

export interface Chunk {
  content: string;
  index: number;
  startChar: number;
  endChar: number;
  tokenCount: number;
}

const DEFAULT_SEPARATORS = [
  '\n\n\n',   // Section breaks
  '\n\n',     // Paragraphs
  '\n',       // Lines
  '. ',       // Sentences
  '? ',
  '! ',
  '; ',
  ', ',       // Clauses
  ' ',        // Words
  '',         // Characters (fallback)
];

export function chunkDocument(
  text: string,
  chunkSize: number = 500,
  chunkOverlap: number = 50
): Chunk[] {
  const chunks: Chunk[] = [];
  let currentPosition = 0;
  let chunkIndex = 0;

  while (currentPosition < text.length) {
    let endPosition = Math.min(currentPosition + chunkSize, text.length);

    // Find best split point at separator
    if (endPosition < text.length) {
      endPosition = findBestSplitPoint(text, currentPosition, endPosition);
    }

    const content = text.slice(currentPosition, endPosition).trim();

    if (content.length > 0) {
      chunks.push({
        content,
        index: chunkIndex,
        startChar: currentPosition,
        endChar: endPosition,
        tokenCount: Math.ceil(content.length / 4), // Rough estimate
      });
      chunkIndex++;
    }

    // Advance with overlap
    currentPosition += Math.max(endPosition - currentPosition - chunkOverlap, 1);
  }

  return chunks;
}

function findBestSplitPoint(
  text: string,
  start: number,
  end: number
): number {
  for (const separator of DEFAULT_SEPARATORS) {
    if (!separator) continue;

    const searchStart = Math.max(start, end - Math.floor((end - start) * 0.3));
    const searchRegion = text.slice(searchStart, end);
    const lastIndex = searchRegion.lastIndexOf(separator);

    if (lastIndex !== -1) {
      return searchStart + lastIndex + separator.length;
    }
  }

  return end;
}
```

### Embedding Generation

```typescript
// src/lib/rag/embeddings.ts

import { LLMAdapter } from '@/lib/llm/adapter';
import { Chunk } from './chunker';

export async function generateChunkEmbeddings(
  chunks: Chunk[],
  adapter: LLMAdapter
): Promise<Array<Chunk & { embedding: number[] }>> {
  // Batch embedding for efficiency
  const embeddings = await adapter.embedBatch(
    chunks.map(c => c.content)
  );

  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i].embedding,
  }));
}
```

---

## 2. Retrieval

### Vector Search

The `match_documents` function performs cosine similarity search:

```sql
-- Returns top-K most similar chunks
SELECT
    id,
    doc_id,
    content,
    doc_title,
    chunk_index,
    1 - (embedding <=> query_embedding) AS similarity
FROM document_chunks
WHERE company_slug = 'acme-corp'
  AND 1 - (embedding <=> query_embedding) > 0.6  -- Threshold
ORDER BY embedding <=> query_embedding
LIMIT 5;  -- Top K
```

### Retrieval Implementation

```typescript
// src/lib/rag/retrieval.ts

import { createServerClient } from '@/lib/supabase/server';
import { LLMAdapter } from '@/lib/llm/adapter';

export interface RetrievedContext {
  chunkId: string;
  docId: string;
  docTitle: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export interface RetrievalResult {
  contexts: RetrievedContext[];
  scores: number[];
  retrievalMs: number;
}

export async function retrieveRelevantChunks(
  question: string,
  companySlug: string,
  adapter: LLMAdapter,
  config: { topK: number; confidenceThreshold: number }
): Promise<RetrievalResult> {
  const startTime = Date.now();

  // 1. Generate question embedding
  const { embedding } = await adapter.embed(question);

  // 2. Vector search in Supabase
  const supabase = createServerClient();

  const { data: chunks, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_company_slug: companySlug,
    match_threshold: config.confidenceThreshold,
    match_count: config.topK,
  });

  if (error) throw new Error(`Retrieval failed: ${error.message}`);

  const retrievalMs = Date.now() - startTime;

  const contexts: RetrievedContext[] = (chunks || []).map((chunk: any) => ({
    chunkId: chunk.id,
    docId: chunk.doc_id,
    docTitle: chunk.doc_title,
    content: chunk.content,
    chunkIndex: chunk.chunk_index,
    score: chunk.similarity,
  }));

  return {
    contexts,
    scores: contexts.map(c => c.score),
    retrievalMs,
  };
}
```

---

## 3. Confidence Scoring

### Scoring Logic

Confidence is calculated as a weighted average of retrieval scores:

```typescript
// src/lib/rag/confidence.ts

/**
 * Calculate overall confidence from retrieval scores.
 * Higher weight for top results (they matter more).
 */
export function calculateConfidence(scores: number[]): number {
  if (scores.length === 0) return 0;

  // Weights: 1/1, 1/2, 1/3, ... (top results weighted higher)
  const weights = scores.map((_, i) => 1 / (i + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const weightedSum = scores.reduce((sum, score, i) => {
    return sum + score * weights[i];
  }, 0);

  return weightedSum / totalWeight;
}

/**
 * Check if retrieval results are sufficient to answer.
 */
export function hasSufficientContext(
  scores: number[],
  threshold: number,
  minChunks: number = 1
): boolean {
  const relevantChunks = scores.filter(s => s >= threshold);
  return relevantChunks.length >= minChunks;
}
```

### Confidence Thresholds

| Confidence | Interpretation | Action |
|------------|----------------|--------|
| 0.8 - 1.0 | High | Answer with confidence |
| 0.6 - 0.8 | Medium | Answer with caveats |
| 0.4 - 0.6 | Low | Consider fallback |
| 0.0 - 0.4 | Very Low | Return fallback |

---

## 4. Prompt Engineering

### System Prompt

```typescript
// src/lib/llm/prompts.ts

export function buildRAGSystemPrompt(): string {
  return `You are a helpful assistant that answers questions about company disclosures and documents.

CRITICAL RULES:
1. ONLY use information from the provided context documents
2. NEVER make up or infer information not explicitly stated in the context
3. If the context doesn't contain enough information to answer, say: "I don't have enough information in the provided disclosures to answer that question."
4. Always cite your sources using [Citation N] format where N corresponds to the document number
5. Be concise but thorough
6. If multiple sources say the same thing, cite all relevant sources
7. Maintain a professional, factual tone
8. Do not speculate or provide opinions

CITATION FORMAT:
- Use [Citation 1], [Citation 2], etc. inline with your answer
- Each citation number must correspond to a document in the provided context
- Place citations immediately after the relevant statement`;
}
```

### User Prompt Template

```typescript
export function buildRAGUserPrompt(
  question: string,
  contexts: RetrievedContext[]
): string {
  const contextSection = contexts
    .map((ctx, index) => {
      return `[Document ${index + 1}]
Title: ${ctx.docTitle}
Content: ${ctx.content}`;
    })
    .join('\n\n---\n\n');

  return `Based on the following documents, please answer this question:

QUESTION: ${question}

CONTEXT DOCUMENTS:
${contextSection}

Remember:
- Only use information from the documents above
- Cite sources using [Citation N] format
- If you cannot answer from the provided context, say so clearly`;
}
```

### Example Prompt

```
System: You are a helpful assistant that answers questions about company disclosures...

User: Based on the following documents, please answer this question:

QUESTION: What was the company's revenue in 2024?

CONTEXT DOCUMENTS:
[Document 1]
Title: Annual Report 2024
Content: In fiscal year 2024, Acme Corporation reported total revenues of $4.2 billion, representing a 15% increase from the prior year...

---

[Document 2]
Title: Q4 Earnings Call
Content: Revenue growth was driven primarily by our cloud services division, which grew 25% year-over-year...

Remember:
- Only use information from the documents above
- Cite sources using [Citation N] format
```

---

## 5. Citation Extraction

### Citation Mapping

```typescript
// src/lib/rag/citations.ts

import { Citation } from '@/types/database';
import { RetrievedContext } from './retrieval';

/**
 * Extract citation numbers from LLM answer
 */
export function extractCitationReferences(answer: string): number[] {
  const citationPattern = /\[Citation\s*(\d+)\]/gi;
  const matches = answer.matchAll(citationPattern);
  const citations = new Set<number>();

  for (const match of matches) {
    citations.add(parseInt(match[1], 10));
  }

  return Array.from(citations).sort((a, b) => a - b);
}

/**
 * Map citation numbers to actual context chunks
 */
export function mapCitations(
  answer: string,
  contexts: RetrievedContext[]
): Citation[] {
  const referencedNumbers = extractCitationReferences(answer);

  return referencedNumbers
    .filter(num => num >= 1 && num <= contexts.length)
    .map(num => {
      const ctx = contexts[num - 1];
      return {
        doc_id: ctx.docId,
        title: ctx.docTitle,
        chunk_id: ctx.chunkId,
        snippet: truncateSnippet(ctx.content, 200),
        score: ctx.score,
        chunk_index: ctx.chunkIndex,
      };
    });
}

function truncateSnippet(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;

  const truncated = content.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');

  if (lastPeriod > maxLength * 0.7) {
    return truncated.slice(0, lastPeriod + 1);
  }

  return truncated.trim() + '...';
}
```

### Example Output

**LLM Response:**
```
Based on the Annual Report, Acme Corporation reported total revenues of $4.2 billion in 2024 [Citation 1]. This growth was primarily driven by the cloud services division [Citation 2].
```

**Extracted Citations:**
```json
[
  {
    "doc_id": "uuid-1",
    "title": "Annual Report 2024",
    "chunk_id": "chunk-uuid-1",
    "snippet": "In fiscal year 2024, Acme Corporation reported total revenues of $4.2 billion...",
    "score": 0.89,
    "chunk_index": 5
  },
  {
    "doc_id": "uuid-2",
    "title": "Q4 Earnings Call",
    "chunk_id": "chunk-uuid-2",
    "snippet": "Revenue growth was driven primarily by our cloud services division...",
    "score": 0.82,
    "chunk_index": 3
  }
]
```

---

## 6. Fallback Behavior

### When to Return Fallback

1. **No relevant chunks found** (empty retrieval)
2. **All scores below threshold** (low confidence)
3. **Too few relevant chunks** (insufficient context)

### Fallback Response

```typescript
const FALLBACK_ANSWER = "I don't have enough information in the provided disclosures to answer that question.";

// In API route
if (!hasSufficientContext(scores, config.confidenceThreshold) || contexts.length === 0) {
  return {
    answer: FALLBACK_ANSWER,
    citations: [],
    confidence: 0,
    debug: { ... }
  };
}
```

---

## 7. Performance Optimization

### Embedding Cache (Future)

```typescript
// Cache question embeddings for repeated queries
const embeddingCache = new Map<string, number[]>();

async function getOrCreateEmbedding(
  text: string,
  adapter: LLMAdapter
): Promise<number[]> {
  const cacheKey = createHash('sha256').update(text).digest('hex');

  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  const { embedding } = await adapter.embed(text);
  embeddingCache.set(cacheKey, embedding);

  return embedding;
}
```

### Batch Processing for Ingestion

```typescript
// Process documents in batches to avoid rate limits
async function processDocumentBatches(
  chunks: Chunk[],
  adapter: LLMAdapter,
  batchSize: number = 100
): Promise<void> {
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await adapter.embedBatch(batch.map(c => c.content));

    // Insert batch into database
    await insertChunksWithEmbeddings(batch, embeddings);

    // Rate limit: wait between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

---

## 8. Metrics & Debugging

### Debug Info Captured

```typescript
interface DebugInfo {
  retrieval_ms: number;       // Time for embedding + vector search
  llm_ms: number;             // Time for LLM generation
  total_ms: number;           // Total request time
  model: string;              // LLM model used
  chunks_retrieved: number;   // Number of chunks found
  prompt_tokens?: number;     // Tokens in prompt
  completion_tokens?: number; // Tokens in response
}
```

### Logging for Analysis

All Q&A interactions are logged to `qa_logs` table, including:
- **Greetings** (e.g., "hello", "hi") - logged with confidence 0
- **No-context queries** - when no relevant chunks found
- **Normal queries** - with citations and confidence scores

Each log entry contains:
- Question and answer text
- Citations used (empty array for greetings/no-context)
- Confidence score (0 for greetings/no-context)
- Debug metrics (duration, chunks retrieved)
- Session ID (for conversation tracking)

This enables:
- Quality analysis over time
- Identifying problematic questions
- Model performance tracking
- Cost estimation
- Conversation session analysis
