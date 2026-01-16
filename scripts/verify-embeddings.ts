/**
 * Verify embeddings are stored correctly
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import OpenAI from 'openai';

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Get a chunk from the Risk Factors document
    const chunks = await db.execute(sql`
      SELECT dc.id, dc.content, dc.embedding::text as embedding_text
      FROM document_chunks dc
      JOIN documents d ON dc.doc_id = d.id
      WHERE d.title LIKE '%Risk Factors%'
      LIMIT 1
    `);

    const chunk = chunks[0];
    console.log('Chunk content:', chunk.content.substring(0, 100) + '...');

    // Parse stored embedding
    const storedEmbedding = chunk.embedding_text
      .slice(1, -1)
      .split(',')
      .map(Number);
    console.log('Stored embedding dimensions:', storedEmbedding.length);
    console.log('First 5 values:', storedEmbedding.slice(0, 5));

    // Generate fresh embedding for the same content (with title like seed does)
    const freshResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: `Document: Risk Factors Disclosure\n\n${chunk.content}`,
      dimensions: 3072,
    });
    const freshEmbedding = freshResponse.data[0].embedding;
    console.log('\nFresh embedding dimensions:', freshEmbedding.length);
    console.log('First 5 values:', freshEmbedding.slice(0, 5));

    // Calculate cosine similarity between stored and fresh
    const dotProduct = storedEmbedding.reduce((sum, val, i) => sum + val * freshEmbedding[i], 0);
    const storedMag = Math.sqrt(storedEmbedding.reduce((sum, val) => sum + val * val, 0));
    const freshMag = Math.sqrt(freshEmbedding.reduce((sum, val) => sum + val * val, 0));
    const similarity = dotProduct / (storedMag * freshMag);

    console.log('\nSimilarity between stored and fresh embedding:', similarity.toFixed(4));
    console.log('(Should be ~1.0 if embeddings match)');

    // Now test query embedding
    const query = 'What are the key risk factors?';
    const queryResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: query,
      dimensions: 3072,
    });
    const queryEmbedding = queryResponse.data[0].embedding;

    // Calculate similarity with stored
    const qDot = storedEmbedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
    const qMag = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
    const qSimilarity = qDot / (storedMag * qMag);

    console.log('\nQuery:', query);
    console.log('Similarity with stored chunk:', qSimilarity.toFixed(4));

    // Calculate similarity with fresh chunk embedding
    const fDot = freshEmbedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
    const fMag = Math.sqrt(freshEmbedding.reduce((sum, val) => sum + val * val, 0));
    const fSimilarity = fDot / (fMag * qMag);

    console.log('Similarity with fresh chunk:', fSimilarity.toFixed(4));

  } finally {
    await client.end();
  }
}

main().catch(console.error);
