/**
 * Test hybrid search
 */

import { getTenantService } from '../src/lib/services/tenant-service';
import { retrieveChunks } from '../src/lib/rag/retrieval';

async function main() {
  console.log('Testing hybrid search...\n');

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb('demo-company');

  if (!tenantDb) {
    console.log('Failed to get tenant DB');
    return;
  }

  const queries = [
    'What are the key risk factors?',
    'What is the company growth strategy?',
    'Tell me about revenue',
    'Who are the board members?',
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    console.log('-'.repeat(50));

    const result = await retrieveChunks(tenantDb, query, process.env.OPENAI_API_KEY!, {
      topK: 3,
      confidenceThreshold: 0.6,
    });

    console.log(`Found ${result.chunks.length} chunks:`);
    for (const chunk of result.chunks) {
      console.log(`  - ${chunk.document.title}`);
      console.log(`    Score: ${chunk.similarity.toFixed(3)} | Confidence: ${(chunk.confidence * 100).toFixed(0)}%`);
      console.log(`    "${chunk.content.substring(0, 80)}..."`);
    }
  }
}

main().catch(console.error);
