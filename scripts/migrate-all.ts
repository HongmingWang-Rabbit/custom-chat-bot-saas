/**
 * Database Migration Script
 *
 * Runs migrations on both the main database and all tenant databases.
 * Designed to be run during deployment or manually.
 *
 * Usage:
 *   npm run migrate:all
 *
 * Environment:
 *   DATABASE_URL - Main database connection string
 *   MASTER_KEY - For decrypting tenant credentials
 *
 * Options:
 *   --main-only    Only migrate main database
 *   --tenants-only Only migrate tenant databases
 *   --dry-run      Show what would be migrated without executing
 *   --tenant=slug  Migrate a specific tenant only
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

// =============================================================================
// Configuration
// =============================================================================

const MIGRATION_TIMEOUT_MS = 60000; // 60 seconds per database

// =============================================================================
// Schema (inline to avoid import issues in scripts)
// =============================================================================

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  encryptedDatabaseUrl: text('encrypted_database_url').notNull(),
  status: varchar('status', { length: 20 }).default('active'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Encryption (inline to avoid import issues)
// =============================================================================

function decrypt(encryptedData: string): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    throw new Error('MASTER_KEY environment variable is required');
  }

  const key = Buffer.from(masterKey, 'base64');
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivBase64, authTagBase64, ciphertext] = parts;
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const encrypted = Buffer.from(ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

// =============================================================================
// Migration SQL
// =============================================================================

/**
 * Main database migrations.
 * Add new migrations here as needed.
 */
const MAIN_MIGRATIONS = [
  {
    name: 'ensure_tenants_table',
    sql: `
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        encrypted_database_url TEXT NOT NULL,
        encrypted_service_key TEXT,
        encrypted_anon_key TEXT,
        encrypted_llm_api_key TEXT,
        database_host VARCHAR(255),
        database_region VARCHAR(50),
        branding JSONB DEFAULT '{}',
        llm_provider VARCHAR(50) DEFAULT 'openai',
        rag_config JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
    `,
  },
];

/**
 * Tenant database migrations.
 * These run on every tenant database.
 */
const TENANT_MIGRATIONS = [
  {
    name: 'enable_pgvector',
    sql: `CREATE EXTENSION IF NOT EXISTS vector;`,
  },
  {
    name: 'ensure_documents_table',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        url VARCHAR(1000),
        doc_type VARCHAR(50) DEFAULT 'disclosure',
        file_name VARCHAR(255),
        file_size INTEGER,
        mime_type VARCHAR(100),
        storage_key VARCHAR(500),
        status VARCHAR(20) DEFAULT 'pending',
        chunk_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
    `,
  },
  {
    name: 'add_storage_key_column',
    sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500);`,
  },
  {
    name: 'ensure_document_chunks_table',
    sql: `
      CREATE TABLE IF NOT EXISTS document_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding vector(1536),
        chunk_index INTEGER NOT NULL,
        start_char INTEGER,
        end_char INTEGER,
        token_count INTEGER,
        doc_title VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id ON document_chunks(doc_id);
    `,
  },
  {
    name: 'ensure_qa_logs_table',
    sql: `
      CREATE TABLE IF NOT EXISTS qa_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations JSONB DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        retrieval_scores JSONB,
        flagged BOOLEAN DEFAULT FALSE,
        flagged_at TIMESTAMPTZ,
        flagged_reason VARCHAR(500),
        reviewed BOOLEAN DEFAULT FALSE,
        reviewed_at TIMESTAMPTZ,
        reviewer_notes TEXT,
        debug_info JSONB DEFAULT '{}',
        user_agent VARCHAR(500),
        ip_address VARCHAR(45),
        session_id VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_qa_logs_flagged ON qa_logs(flagged);
      CREATE INDEX IF NOT EXISTS idx_qa_logs_created_at ON qa_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_qa_logs_confidence ON qa_logs(confidence);
    `,
  },
  {
    name: 'ensure_settings_table',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: 'ensure_vector_index',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
      ON document_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `,
    optional: true, // May fail on empty tables
  },
  {
    name: 'ensure_match_documents_function',
    sql: `
      CREATE OR REPLACE FUNCTION match_documents(
        query_embedding vector(1536),
        match_count INT DEFAULT 5,
        match_threshold FLOAT DEFAULT 0.0
      )
      RETURNS TABLE(
        id UUID,
        doc_id UUID,
        content TEXT,
        doc_title VARCHAR(500),
        chunk_index INTEGER,
        similarity FLOAT
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN QUERY
        SELECT
          dc.id,
          dc.doc_id,
          dc.content,
          dc.doc_title,
          dc.chunk_index,
          1 - (dc.embedding <=> query_embedding) AS similarity
        FROM document_chunks dc
        WHERE dc.embedding IS NOT NULL
          AND 1 - (dc.embedding <=> query_embedding) > match_threshold
        ORDER BY dc.embedding <=> query_embedding
        LIMIT match_count;
      END;
      $$;
    `,
  },
  {
    name: 'add_company_slug_to_documents',
    sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100);`,
  },
  {
    name: 'add_company_slug_to_document_chunks',
    sql: `ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100);`,
  },
  {
    name: 'add_company_slug_to_qa_logs',
    sql: `ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100);`,
  },
  {
    name: 'add_company_slug_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_documents_company_slug ON documents(company_slug);
      CREATE INDEX IF NOT EXISTS idx_document_chunks_company_slug ON document_chunks(company_slug);
      CREATE INDEX IF NOT EXISTS idx_qa_logs_company_slug ON qa_logs(company_slug);
    `,
  },
];

// =============================================================================
// Migration Runner
// =============================================================================

interface MigrationResult {
  database: string;
  success: boolean;
  migrationsRun: string[];
  errors: string[];
  durationMs: number;
}

async function runMigrations(
  connectionString: string,
  migrations: Array<{ name: string; sql: string; optional?: boolean }>,
  databaseName: string
): Promise<MigrationResult> {
  const startTime = Date.now();
  const migrationsRun: string[] = [];
  const errors: string[] = [];

  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });

  try {
    for (const migration of migrations) {
      try {
        await client.unsafe(migration.sql);
        migrationsRun.push(migration.name);
        console.log(`  ✓ ${migration.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (migration.optional) {
          console.log(`  ⚠ ${migration.name} (skipped: ${message})`);
        } else {
          errors.push(`${migration.name}: ${message}`);
          console.log(`  ✗ ${migration.name}: ${message}`);
        }
      }
    }

    return {
      database: databaseName,
      success: errors.length === 0,
      migrationsRun,
      errors,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await client.end();
  }
}

/**
 * Update company_slug values for existing data in a tenant database.
 * This ensures all rows have the correct tenant slug after migration.
 */
async function updateCompanySlugValues(
  connectionString: string,
  tenantSlug: string
): Promise<{ updated: boolean; counts: { documents: number; chunks: number; qaLogs: number } }> {
  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });

  try {
    // Update documents where company_slug is NULL or placeholder
    const docsResult = await client.unsafe(`
      UPDATE documents
      SET company_slug = '${tenantSlug}'
      WHERE company_slug IS NULL OR company_slug = 'migrated'
    `);
    const docsUpdated = docsResult.count ?? 0;

    // Update document_chunks where company_slug is NULL or placeholder
    const chunksResult = await client.unsafe(`
      UPDATE document_chunks
      SET company_slug = '${tenantSlug}'
      WHERE company_slug IS NULL OR company_slug = 'migrated'
    `);
    const chunksUpdated = chunksResult.count ?? 0;

    // Update qa_logs where company_slug is NULL or placeholder
    const logsResult = await client.unsafe(`
      UPDATE qa_logs
      SET company_slug = '${tenantSlug}'
      WHERE company_slug IS NULL OR company_slug = 'migrated'
    `);
    const logsUpdated = logsResult.count ?? 0;

    // Add NOT NULL constraint if not already present (idempotent)
    try {
      await client.unsafe(`ALTER TABLE documents ALTER COLUMN company_slug SET NOT NULL`);
      await client.unsafe(`ALTER TABLE document_chunks ALTER COLUMN company_slug SET NOT NULL`);
      await client.unsafe(`ALTER TABLE qa_logs ALTER COLUMN company_slug SET NOT NULL`);
    } catch {
      // Constraints may already exist, ignore errors
    }

    return {
      updated: true,
      counts: {
        documents: Number(docsUpdated),
        chunks: Number(chunksUpdated),
        qaLogs: Number(logsUpdated),
      },
    };
  } finally {
    await client.end();
  }
}

// =============================================================================
// Main Script
// =============================================================================

interface Options {
  mainOnly: boolean;
  tenantsOnly: boolean;
  dryRun: boolean;
  specificTenant: string | null;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  return {
    mainOnly: args.includes('--main-only'),
    tenantsOnly: args.includes('--tenants-only'),
    dryRun: args.includes('--dry-run'),
    specificTenant: args.find((a) => a.startsWith('--tenant='))?.split('=')[1] ?? null,
  };
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Database Migration Script                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const options = parseArgs();
  const results: MigrationResult[] = [];

  // Validate environment
  const mainDbUrl = process.env.DATABASE_URL;
  if (!mainDbUrl) {
    console.error('✗ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // ==========================================================================
  // Main Database Migration
  // ==========================================================================

  if (!options.tenantsOnly) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Main Database');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (options.dryRun) {
      console.log('  Would run migrations:', MAIN_MIGRATIONS.map((m) => m.name).join(', '));
    } else {
      const result = await runMigrations(mainDbUrl, MAIN_MIGRATIONS, 'main');
      results.push(result);
      console.log(`  Duration: ${result.durationMs}ms`);
    }
    console.log('');
  }

  // ==========================================================================
  // Tenant Database Migrations
  // ==========================================================================

  if (!options.mainOnly) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Tenant Databases');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Connect to main DB to get tenant list
    const mainClient = postgres(mainDbUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 30,
    });

    try {
      const mainDb = drizzle(mainClient);

      // Build query
      const query = mainDb
        .select({
          slug: tenants.slug,
          name: tenants.name,
          encryptedDatabaseUrl: tenants.encryptedDatabaseUrl,
        })
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      const tenantList = await query;

      if (tenantList.length === 0) {
        console.log('  No active tenants found');
      } else {
        console.log(`  Found ${tenantList.length} active tenant(s)\n`);

        for (const tenant of tenantList) {
          // Filter by specific tenant if requested
          if (options.specificTenant && tenant.slug !== options.specificTenant) {
            continue;
          }

          console.log(`  ┌─ ${tenant.name} (${tenant.slug})`);

          if (options.dryRun) {
            console.log(`  │  Would run ${TENANT_MIGRATIONS.length} migrations`);
            console.log(`  └─ Skipped (dry run)\n`);
            continue;
          }

          try {
            // Decrypt database URL
            const decryptedUrl = decrypt(tenant.encryptedDatabaseUrl);

            // Run migrations
            const result = await runMigrations(
              decryptedUrl,
              TENANT_MIGRATIONS,
              tenant.slug
            );
            results.push(result);

            // Post-migration: Update company_slug values with actual tenant slug
            if (result.success) {
              try {
                const slugUpdate = await updateCompanySlugValues(decryptedUrl, tenant.slug);
                const totalUpdated = slugUpdate.counts.documents + slugUpdate.counts.chunks + slugUpdate.counts.qaLogs;
                if (totalUpdated > 0) {
                  console.log(`  │  ✓ Updated company_slug: ${slugUpdate.counts.documents} docs, ${slugUpdate.counts.chunks} chunks, ${slugUpdate.counts.qaLogs} logs`);
                }
              } catch (slugError) {
                const slugMessage = slugError instanceof Error ? slugError.message : String(slugError);
                console.log(`  │  ⚠ company_slug update warning: ${slugMessage}`);
              }
            }

            console.log(`  └─ ${result.success ? '✓ Success' : '✗ Failed'} (${result.durationMs}ms)\n`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`  └─ ✗ Error: ${message}\n`);
            results.push({
              database: tenant.slug,
              success: false,
              migrationsRun: [],
              errors: [message],
              durationMs: 0,
            });
          }
        }
      }
    } finally {
      await mainClient.end();
    }
  }

  // ==========================================================================
  // Summary
  // ==========================================================================

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (options.dryRun) {
    console.log('  Dry run complete - no changes made');
  } else {
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);

    console.log(`  Databases migrated: ${successful}/${results.length}`);
    if (failed > 0) {
      console.log(`  Failed: ${failed}`);
      for (const result of results.filter((r) => !r.success)) {
        console.log(`    - ${result.database}: ${result.errors.join(', ')}`);
      }
    }
    console.log(`  Total duration: ${totalDuration}ms`);

    if (failed > 0) {
      process.exit(1);
    }
  }

  console.log('');
}

// Run the script
main().catch((error) => {
  console.error('Migration script failed:', error);
  process.exit(1);
});
