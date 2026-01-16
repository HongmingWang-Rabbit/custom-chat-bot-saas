/**
 * Tenant Database Migrations
 *
 * SQL migrations to set up a new tenant database with:
 * - pgvector extension
 * - documents table
 * - document_chunks table (with vector embeddings)
 * - qa_logs table
 * - settings table
 * - Vector similarity search index
 */

import postgres from 'postgres';

// =============================================================================
// Migration SQL
// =============================================================================

/**
 * SQL to enable pgvector extension.
 */
const ENABLE_PGVECTOR = `
CREATE EXTENSION IF NOT EXISTS vector;
`;

/**
 * SQL to create the documents table.
 */
const CREATE_DOCUMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_slug VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  url VARCHAR(1000),

  -- Metadata
  doc_type VARCHAR(50) DEFAULT 'disclosure',
  file_name VARCHAR(255),
  file_size INTEGER,
  mime_type VARCHAR(100),

  -- Storage (Supabase Storage)
  storage_key VARCHAR(500),

  -- Processing status
  status VARCHAR(20) DEFAULT 'pending',
  chunk_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_company_slug ON documents(company_slug);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
`;

/**
 * SQL to add storage_key column to existing documents table.
 * This is an incremental migration for existing tenant databases.
 */
const ADD_STORAGE_KEY_COLUMN = `
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500);
`;

/**
 * SQL to add company_slug column to existing documents table.
 * This is an incremental migration for existing tenant databases.
 */
const ADD_COMPANY_SLUG_TO_DOCUMENTS = `
ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_documents_company_slug ON documents(company_slug);
`;

/**
 * SQL to add company_slug column to existing document_chunks table.
 * This is an incremental migration for existing tenant databases.
 */
const ADD_COMPANY_SLUG_TO_CHUNKS = `
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS company_slug VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_document_chunks_company_slug ON document_chunks(company_slug);
`;

/**
 * SQL to create the document_chunks table with pgvector.
 */
const CREATE_DOCUMENT_CHUNKS_TABLE = `
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  company_slug VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,

  -- pgvector embedding (3072 dimensions for OpenAI text-embedding-3-large)
  embedding vector(3072),

  -- Position tracking
  chunk_index INTEGER NOT NULL,
  start_char INTEGER,
  end_char INTEGER,
  token_count INTEGER,

  -- Denormalized for faster retrieval
  doc_title VARCHAR(500),

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id ON document_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_company_slug ON document_chunks(company_slug);
`;

/**
 * SQL to create vector similarity search index.
 * IVFFlat index for approximate nearest neighbor search.
 */
const CREATE_VECTOR_INDEX = `
-- IVFFlat index for vector similarity search
-- lists = number of clusters, adjust based on data size
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
`;

/**
 * SQL to create the qa_logs table.
 */
const CREATE_QA_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS qa_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,

  -- Citations (JSONB array)
  citations JSONB DEFAULT '[]',

  -- Quality metrics
  confidence REAL NOT NULL DEFAULT 0,
  retrieval_scores JSONB,

  -- Review workflow
  flagged BOOLEAN DEFAULT FALSE,
  flagged_at TIMESTAMPTZ,
  flagged_reason VARCHAR(500),
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,

  -- Debug info (JSONB)
  debug_info JSONB DEFAULT '{}',

  -- Request metadata
  user_agent VARCHAR(500),
  ip_address VARCHAR(45),
  session_id VARCHAR(100),

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_qa_logs_flagged ON qa_logs(flagged);
CREATE INDEX IF NOT EXISTS idx_qa_logs_created_at ON qa_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_qa_logs_confidence ON qa_logs(confidence);
`;

/**
 * SQL to create the settings table.
 */
const CREATE_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

/**
 * SQL to create the match_documents function for vector search.
 */
const CREATE_MATCH_DOCUMENTS_FUNCTION = `
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(3072),
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
`;

// =============================================================================
// Migration Runner
// =============================================================================

export interface MigrationResult {
  success: boolean;
  migrationsRun: string[];
  errors: string[];
  durationMs: number;
}

/**
 * Run all tenant database migrations.
 *
 * @param databaseUrl - PostgreSQL connection string for the tenant database
 * @returns Migration result with details
 */
export async function runTenantMigrations(
  databaseUrl: string
): Promise<MigrationResult> {
  const startTime = Date.now();
  const migrationsRun: string[] = [];
  const errors: string[] = [];

  console.log('[Migrations] Starting tenant database migrations...');

  // Create a direct postgres connection for migrations
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });

  try {
    // 1. Enable pgvector extension
    console.log('[Migrations] Enabling pgvector extension...');
    await sql.unsafe(ENABLE_PGVECTOR);
    migrationsRun.push('pgvector_extension');

    // 2. Create documents table
    console.log('[Migrations] Creating documents table...');
    await sql.unsafe(CREATE_DOCUMENTS_TABLE);
    migrationsRun.push('documents_table');

    // 2b. Add storage_key column (for existing databases)
    console.log('[Migrations] Adding storage_key column...');
    await sql.unsafe(ADD_STORAGE_KEY_COLUMN);
    migrationsRun.push('storage_key_column');

    // 2c. Add company_slug column to documents (for existing databases)
    console.log('[Migrations] Adding company_slug to documents...');
    await sql.unsafe(ADD_COMPANY_SLUG_TO_DOCUMENTS);
    migrationsRun.push('company_slug_documents');

    // 3. Create document_chunks table
    console.log('[Migrations] Creating document_chunks table...');
    await sql.unsafe(CREATE_DOCUMENT_CHUNKS_TABLE);
    migrationsRun.push('document_chunks_table');

    // 3b. Add company_slug column to document_chunks (for existing databases)
    console.log('[Migrations] Adding company_slug to document_chunks...');
    await sql.unsafe(ADD_COMPANY_SLUG_TO_CHUNKS);
    migrationsRun.push('company_slug_chunks');

    // 4. Create qa_logs table
    console.log('[Migrations] Creating qa_logs table...');
    await sql.unsafe(CREATE_QA_LOGS_TABLE);
    migrationsRun.push('qa_logs_table');

    // 5. Create settings table
    console.log('[Migrations] Creating settings table...');
    await sql.unsafe(CREATE_SETTINGS_TABLE);
    migrationsRun.push('settings_table');

    // 6. Create vector index (may fail if no data yet, that's OK)
    console.log('[Migrations] Creating vector similarity index...');
    try {
      await sql.unsafe(CREATE_VECTOR_INDEX);
      migrationsRun.push('vector_index');
    } catch (indexError) {
      // Index creation might fail on empty table, we'll retry later
      console.log('[Migrations] Vector index creation deferred (table may be empty)');
    }

    // 7. Create match_documents function
    console.log('[Migrations] Creating match_documents function...');
    await sql.unsafe(CREATE_MATCH_DOCUMENTS_FUNCTION);
    migrationsRun.push('match_documents_function');

    const durationMs = Date.now() - startTime;
    console.log(
      `[Migrations] Completed ${migrationsRun.length} migrations in ${durationMs}ms`
    );

    return {
      success: true,
      migrationsRun,
      errors,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    console.error('[Migrations] Migration failed:', message);

    return {
      success: false,
      migrationsRun,
      errors,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Verify that a tenant database has the required schema.
 */
export async function verifyTenantSchema(databaseUrl: string): Promise<{
  valid: boolean;
  missingTables: string[];
}> {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });

  const requiredTables = ['documents', 'document_chunks', 'qa_logs', 'settings'];
  const missingTables: string[] = [];

  try {
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${requiredTables})
    `;

    const existingTables = result.map((r) => r.table_name);

    for (const table of requiredTables) {
      if (!existingTables.includes(table)) {
        missingTables.push(table);
      }
    }

    return {
      valid: missingTables.length === 0,
      missingTables,
    };
  } finally {
    await sql.end();
  }
}
