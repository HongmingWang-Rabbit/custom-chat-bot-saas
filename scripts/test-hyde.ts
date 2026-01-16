/**
 * Test HyDE improvement
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { generateHypotheticalDocument } from '../src/lib/rag/hyde';

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const query = 'What are the key risk factors?';
    console.log('Original query:', query);

    // Generate hypothetical document
    const hypothetical = await generateHypotheticalDocument(query, process.env.OPENAI_API_KEY!);
    console.log('\nHypothetical document:', hypothetical);

    // Get a chunk from Risk Factors
    const chunks = await db.execute(sql`
      SELECT dc.content, dc.embedding::text as embedding_text
      FROM document_chunks dc
      JOIN documents d ON dc.doc_id = d.id
      WHERE d.title LIKE '%Risk Factors%'
      LIMIT 1
    `);

    const chunk = chunks[0] as { content: string; embedding_text: string };
    const storedEmbedding = chunk.embedding_text
      .slice(1, -1)
      .split(',')
      .map(Number);

    // Embed original query
    const queryResp = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: query,
      dimensions: 3072,
    });
    const queryEmbedding = queryResp.data[0].embedding;

    // Embed hypothetical document
    const hydeResp = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: hypothetical,
      dimensions: 3072,
    });
    const hydeEmbedding = hydeResp.data[0].embedding;

    // Calculate similarities
    const calcSimilarity = (a: number[], b: number[]) => {
      const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dot / (magA * magB);
    };

    const querySimilarity = calcSimilarity(storedEmbedding, queryEmbedding);
    const hydeSimilarity = calcSimilarity(storedEmbedding, hydeEmbedding);

    console.log('\n--- Results ---');
    console.log('Query → Chunk similarity:', querySimilarity.toFixed(4));
    console.log('HyDE → Chunk similarity: ', hydeSimilarity.toFixed(4));
    console.log('Improvement:', ((hydeSimilarity - querySimilarity) / querySimilarity * 100).toFixed(1) + '%');

  } finally {
    await client.end();
  }
}

main().catch(console.error);
