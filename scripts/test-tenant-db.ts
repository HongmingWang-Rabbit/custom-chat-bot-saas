/**
 * Test tenant database connection
 */

import { getTenantService } from '../src/lib/services/tenant-service';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Testing tenant database connection...\n');

  const tenantService = getTenantService();

  // Get tenant with secrets
  const tenant = await tenantService.getTenantWithSecrets('demo-company');
  if (!tenant) {
    console.log('Tenant not found!');
    return;
  }

  console.log('Tenant found:');
  console.log('  - slug:', tenant.slug);
  console.log('  - name:', tenant.name);
  console.log('  - status:', tenant.status);
  console.log('  - has databaseUrl:', !!tenant.databaseUrl);
  console.log('  - databaseUrl preview:', tenant.databaseUrl?.substring(0, 50) + '...');

  // Get tenant database
  const tenantDb = await tenantService.getTenantDb('demo-company');
  if (!tenantDb) {
    console.log('\nFailed to get tenant database!');
    return;
  }

  console.log('\nTenant database connected. Testing query...');

  // Test query
  const docs = await tenantDb.execute(sql`
    SELECT COUNT(*) as count FROM documents WHERE status = 'ready'
  `);
  console.log('Documents with status ready:', docs[0].count);

  const chunks = await tenantDb.execute(sql`
    SELECT COUNT(*) as count FROM document_chunks WHERE embedding IS NOT NULL
  `);
  console.log('Chunks with embeddings:', chunks[0].count);

  // Test the exact query used in retrieval
  console.log('\nTesting vector search query...');
  const testResults = await tenantDb.execute(sql`
    SELECT
      dc.id as chunk_id,
      dc.content,
      dc.chunk_index,
      d.id as document_id,
      d.title as document_title
    FROM document_chunks dc
    JOIN documents d ON dc.doc_id = d.id
    WHERE d.status = 'ready'
    LIMIT 3
  `);
  console.log('Test query returned', testResults.length, 'rows');
  for (const row of testResults) {
    console.log(`  - ${row.document_title} chunk ${row.chunk_index}`);
  }

  // Test full RAG retrieval
  console.log('\n--- Testing RAG retrieval ---');
  const { retrieveChunks } = await import('../src/lib/rag/retrieval');

  const query = 'What are the key risk factors?';
  console.log('Query:', query);

  const result = await retrieveChunks(tenantDb, query, process.env.OPENAI_API_KEY || null, {
    topK: 5,
    confidenceThreshold: 0.6,
  });

  console.log('Embedding tokens used:', result.queryEmbeddingTokens);
  console.log('Chunks retrieved:', result.chunks.length);

  for (const chunk of result.chunks) {
    console.log(`  - ${chunk.document.title} (similarity: ${chunk.similarity.toFixed(3)})`);
    console.log(`    "${chunk.content.substring(0, 100)}..."`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
