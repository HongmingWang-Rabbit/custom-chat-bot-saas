/**
 * Embedding Migration Script
 *
 * Migrates tenant databases from vector(1536) to vector(3072)
 * and regenerates all embeddings using text-embedding-3-large.
 *
 * Usage:
 *   npx tsx scripts/migrate-embeddings.ts
 *   npx tsx scripts/migrate-embeddings.ts --tenant=omeca  # Single tenant
 *   npx tsx scripts/migrate-embeddings.ts --dry-run       # Preview only
 *
 * Environment:
 *   DATABASE_URL - Main database connection string
 *   MASTER_KEY - For decrypting tenant credentials
 *   OPENAI_API_KEY - For generating embeddings
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';
import OpenAI from 'openai';

// =============================================================================
// Configuration
// =============================================================================

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 3072;
const BATCH_SIZE = 100;

// =============================================================================
// Encryption Utilities
// =============================================================================

const ALGORITHM = 'aes-256-gcm';

function getMasterKey(): Buffer {
  const masterKeyBase64 = process.env.MASTER_KEY;
  if (!masterKeyBase64) {
    throw new Error('MASTER_KEY environment variable is not set');
  }
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY must be 32 bytes (256 bits) when decoded');
  }
  return key;
}

function decrypt(encryptedData: string): string {
  const key = getMasterKey();
  const [ivB64, authTagB64, ciphertextB64] = encryptedData.split(':');

  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

// =============================================================================
// Embedding Service
// =============================================================================

async function generateEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const client = new OpenAI({ apiKey });

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    const sortedData = response.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sortedData.map((d) => d.embedding));

    console.log(`    Processed ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} chunks`);
  }

  return allEmbeddings;
}

// =============================================================================
// Migration Functions
// =============================================================================

interface Tenant {
  slug: string;
  name: string;
  encrypted_database_url: string | null;
}

interface Chunk {
  id: string;
  content: string;
}

async function getTenants(mainDb: ReturnType<typeof drizzle>): Promise<Tenant[]> {
  const result = await mainDb.execute(sql`
    SELECT slug, name, encrypted_database_url
    FROM tenants
    WHERE status = 'active' AND encrypted_database_url IS NOT NULL
    ORDER BY slug
  `);
  return result as unknown as Tenant[];
}

async function migrateTenant(
  tenant: Tenant,
  openaiApiKey: string,
  dryRun: boolean
): Promise<{ success: boolean; chunksUpdated: number; error?: string }> {
  if (!tenant.encrypted_database_url) {
    return { success: false, chunksUpdated: 0, error: 'No database URL' };
  }

  let tenantClient: ReturnType<typeof postgres> | null = null;

  try {
    const databaseUrl = decrypt(tenant.encrypted_database_url);
    tenantClient = postgres(databaseUrl, { max: 1 });
    const tenantDb = drizzle(tenantClient);

    // Check current vector dimension
    const columnInfo = await tenantDb.execute(sql`
      SELECT atttypmod
      FROM pg_attribute
      WHERE attrelid = 'document_chunks'::regclass
      AND attname = 'embedding'
    `);

    const currentDim = columnInfo[0]?.atttypmod;
    console.log(`  Current embedding dimension: ${currentDim || 'unknown'}`);

    if (dryRun) {
      // Just count chunks
      const countResult = await tenantDb.execute(sql`
        SELECT COUNT(*) as count FROM document_chunks
      `);
      const chunkCount = Number(countResult[0]?.count || 0);
      console.log(`  [DRY RUN] Would migrate ${chunkCount} chunks`);
      return { success: true, chunksUpdated: chunkCount };
    }

    // Step 1: Get all chunks
    const chunks = await tenantDb.execute(sql`
      SELECT id, content FROM document_chunks ORDER BY id
    `) as unknown as Chunk[];

    if (chunks.length === 0) {
      console.log('  No chunks to migrate');
      return { success: true, chunksUpdated: 0 };
    }

    console.log(`  Found ${chunks.length} chunks to migrate`);

    // Step 2: Generate new embeddings
    console.log('  Generating embeddings...');
    const texts = chunks.map(c => c.content);
    const embeddings = await generateEmbeddings(texts, openaiApiKey);

    // Step 3: Alter column dimension (drop and recreate)
    // Use transaction for atomic schema changes with rollback capability
    console.log('  Updating table schema...');

    // Clean up any leftover temp column from failed previous runs
    await tenantDb.execute(sql`
      ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_new
    `).catch((err) => {
      console.log(`    Note: cleanup of embedding_new column: ${err.message || 'skipped'}`);
    });

    // Begin transaction for schema changes
    await tenantDb.execute(sql`BEGIN`);

    try {
      await tenantDb.execute(sql`
        ALTER TABLE document_chunks ADD COLUMN embedding_new vector(3072)
      `);

      // Step 4: Update embeddings
      // Validate and format embeddings safely (values are floats from OpenAI API)
      console.log('  Updating embeddings...');
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];

        // Validate embedding is array of numbers (defense against unexpected data)
        if (!Array.isArray(embedding) || !embedding.every(v => typeof v === 'number' && isFinite(v))) {
          throw new Error(`Invalid embedding at index ${i}: expected array of finite numbers`);
        }

        // Format as pgvector literal - values are validated floats
        const embeddingStr = `[${embedding.join(',')}]`;

        await tenantDb.execute(sql`
          UPDATE document_chunks
          SET embedding_new = ${embeddingStr}::vector
          WHERE id = ${chunk.id}::uuid
        `);

        if ((i + 1) % 50 === 0 || i === chunks.length - 1) {
          console.log(`    Updated ${i + 1}/${chunks.length} chunks`);
        }
      }

      // Step 5: Swap columns (within transaction)
      console.log('  Finalizing schema changes...');
      await tenantDb.execute(sql`ALTER TABLE document_chunks DROP COLUMN embedding`);
      await tenantDb.execute(sql`ALTER TABLE document_chunks RENAME COLUMN embedding_new TO embedding`);

      // Commit transaction
      await tenantDb.execute(sql`COMMIT`);
      console.log('  ✓ Migration complete');
    } catch (txError) {
      // Rollback on any error
      console.log('  ⚠ Error during migration, rolling back...');
      await tenantDb.execute(sql`ROLLBACK`).catch(() => {});
      throw txError;
    }

    return { success: true, chunksUpdated: chunks.length };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, chunksUpdated: 0, error: errorMessage };
  } finally {
    if (tenantClient) {
      await tenantClient.end();
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('\n🔄 Embedding Migration Script\n');
  console.log(`Target: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dimensions)\n`);

  // Parse arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tenantArg = args.find(a => a.startsWith('--tenant='));
  const targetTenant = tenantArg?.split('=')[1];

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Check environment
  const databaseUrl = process.env.DATABASE_URL;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const masterKey = process.env.MASTER_KEY;

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');
  if (!masterKey) throw new Error('MASTER_KEY is required');

  // Connect to main database
  const mainClient = postgres(databaseUrl, { max: 1 });
  const mainDb = drizzle(mainClient);

  try {
    // Get tenants
    let tenants = await getTenants(mainDb);

    if (targetTenant) {
      tenants = tenants.filter(t => t.slug === targetTenant);
      if (tenants.length === 0) {
        throw new Error(`Tenant '${targetTenant}' not found or not active`);
      }
    }

    console.log(`Found ${tenants.length} tenant(s) to migrate:\n`);

    const results: Array<{
      tenant: string;
      success: boolean;
      chunks: number;
      error?: string;
    }> = [];

    for (const tenant of tenants) {
      console.log(`\n📦 Migrating: ${tenant.name} (${tenant.slug})`);

      const result = await migrateTenant(tenant, openaiApiKey, dryRun);

      results.push({
        tenant: tenant.slug,
        success: result.success,
        chunks: result.chunksUpdated,
        error: result.error,
      });

      if (!result.success) {
        console.log(`  ❌ Failed: ${result.error}`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('Migration Summary');
    console.log('='.repeat(50));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const totalChunks = results.reduce((sum, r) => sum + r.chunks, 0);

    console.log(`\n✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    console.log(`📊 Total chunks ${dryRun ? 'to migrate' : 'migrated'}: ${totalChunks}`);

    if (failed.length > 0) {
      console.log('\nFailed tenants:');
      for (const f of failed) {
        console.log(`  - ${f.tenant}: ${f.error}`);
      }
    }

    console.log('\n');
  } finally {
    await mainClient.end();
  }
}

main().catch((error) => {
  console.error('\n❌ Migration failed:', error.message);
  process.exit(1);
});
