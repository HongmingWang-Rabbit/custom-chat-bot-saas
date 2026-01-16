/**
 * Check database state
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

  console.log('Checking database state...\n');
  console.log('DATABASE_URL:', databaseUrl.replace(/:[^:@]+@/, ':***@'));

  try {
    // Check tenants table
    const tenants = await db.execute(sql`
      SELECT slug, name, database_host, status, is_active
      FROM tenants
    `);
    console.log('\nTenants:');
    for (const t of tenants) {
      console.log(`  - ${t.slug}: host=${t.database_host}, status=${t.status}, active=${t.is_active}`);
    }

    // Check documents
    const docs = await db.execute(sql`
      SELECT id, title, status, company_slug, chunk_count
      FROM documents
    `);
    console.log('\nDocuments:');
    for (const doc of docs) {
      console.log(`  - ${doc.title}: status=${doc.status}, slug=${doc.company_slug}, chunks=${doc.chunk_count}`);
    }

    // Check chunks
    const chunkCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM document_chunks
    `);
    console.log(`\nTotal chunks: ${chunkCount[0].count}`);

    // Check chunks with embeddings
    const embeddingCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM document_chunks WHERE embedding IS NOT NULL
    `);
    console.log(`Chunks with embeddings: ${embeddingCount[0].count}`);

    // Test vector search
    console.log('\nTesting vector search...');
    const testSearch = await db.execute(sql`
      SELECT dc.id, dc.chunk_index, d.title,
             1 - (dc.embedding <=> dc.embedding) as self_similarity
      FROM document_chunks dc
      JOIN documents d ON dc.doc_id = d.id
      WHERE d.status = 'ready'
      LIMIT 3
    `);
    console.log('Sample chunks from ready documents:');
    for (const row of testSearch) {
      console.log(`  - Chunk ${row.chunk_index} from "${row.title}"`);
    }

  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
