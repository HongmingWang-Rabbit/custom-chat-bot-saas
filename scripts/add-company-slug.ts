/**
 * Add company_slug columns to tenant tables
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

  console.log('Adding company_slug columns...\n');

  try {
    // Add to documents
    await db.execute(sql`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100)
    `);
    console.log('✓ Added company_slug to documents');

    // Add to document_chunks
    await db.execute(sql`
      ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100)
    `);
    console.log('✓ Added company_slug to document_chunks');

    // Add to qa_logs
    await db.execute(sql`
      ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100)
    `);
    console.log('✓ Added company_slug to qa_logs');

    // Set default values for existing rows
    await db.execute(sql`UPDATE documents SET company_slug = 'demo-company' WHERE company_slug IS NULL`);
    await db.execute(sql`UPDATE document_chunks SET company_slug = 'demo-company' WHERE company_slug IS NULL`);
    await db.execute(sql`UPDATE qa_logs SET company_slug = 'demo-company' WHERE company_slug IS NULL`);
    console.log('✓ Set default values for existing rows');

    // Add NOT NULL constraint
    await db.execute(sql`ALTER TABLE documents ALTER COLUMN company_slug SET NOT NULL`);
    await db.execute(sql`ALTER TABLE document_chunks ALTER COLUMN company_slug SET NOT NULL`);
    await db.execute(sql`ALTER TABLE qa_logs ALTER COLUMN company_slug SET NOT NULL`);
    console.log('✓ Added NOT NULL constraints');

    // Add indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_documents_company_slug ON documents(company_slug)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_document_chunks_company_slug ON document_chunks(company_slug)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_qa_logs_company_slug ON qa_logs(company_slug)`);
    console.log('✓ Created indexes');

    console.log('\n✅ Done!');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
