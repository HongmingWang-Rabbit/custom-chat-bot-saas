/**
 * Upgrade embeddings from 1536 to 3072 dimensions
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL required');
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  console.log('Upgrading embedding dimensions from 1536 to 3072...\n');

  try {
    // Drop existing vector indexes
    console.log('Dropping existing vector indexes...');
    await db.execute(sql`DROP INDEX IF EXISTS idx_document_chunks_embedding`);
    await db.execute(sql`DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw`);
    console.log('✓ Indexes dropped');

    // Clear existing chunks (they have wrong dimensions)
    console.log('Clearing existing chunks...');
    await db.execute(sql`DELETE FROM document_chunks`);
    console.log('✓ Chunks cleared');

    // Alter column to new dimension
    console.log('Altering embedding column to 3072 dimensions...');
    await db.execute(sql`
      ALTER TABLE document_chunks
      ALTER COLUMN embedding TYPE vector(3072)
    `);
    console.log('✓ Column altered to vector(3072)');

    console.log('\n✅ Done! Now run: npm run seed');

  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
