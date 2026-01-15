# Database Schema

## Overview

The system uses a **two-tier database architecture**:

1. **Main Database**: Stores tenant metadata with encrypted credentials
2. **Tenant Databases**: Each tenant has a dedicated PostgreSQL + pgvector database

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│   MAIN DATABASE                        TENANT DATABASES                         │
│   (Tenant Metadata)                    (Per-Tenant Data)                        │
│                                                                                 │
│   ┌─────────────────┐                  ┌─────────────────┐                      │
│   │     tenants     │                  │    documents    │                      │
│   ├─────────────────┤                  ├─────────────────┤                      │
│   │ id              │                  │ id              │                      │
│   │ slug            │─────────────────►│ title           │                      │
│   │ name            │  decrypt &       │ content         │                      │
│   │ encrypted_db_url│  connect         │ doc_type        │                      │
│   │ encrypted_keys  │                  │ status          │                      │
│   │ branding        │                  └────────┬────────┘                      │
│   │ rag_config      │                           │ 1:N                           │
│   └─────────────────┘                           ▼                               │
│                                        ┌─────────────────┐                      │
│                                        │ document_chunks │                      │
│                                        ├─────────────────┤                      │
│                                        │ id              │                      │
│                                        │ doc_id (FK)     │                      │
│                                        │ content         │                      │
│                                        │ embedding       │◄── pgvector(1536)    │
│                                        │ chunk_index     │                      │
│                                        └─────────────────┘                      │
│                                                                                 │
│                                        ┌─────────────────┐                      │
│                                        │     qa_logs     │                      │
│                                        ├─────────────────┤                      │
│                                        │ id              │                      │
│                                        │ question        │                      │
│                                        │ answer          │                      │
│                                        │ citations       │                      │
│                                        │ confidence      │                      │
│                                        │ flagged         │                      │
│                                        └─────────────────┘                      │
│                                                                                 │
│                                        ┌─────────────────┐                      │
│                                        │     settings    │                      │
│                                        ├─────────────────┤                      │
│                                        │ key (PK)        │                      │
│                                        │ value (JSONB)   │                      │
│                                        └─────────────────┘                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Main Database Schema

### `tenants` Table

Stores tenant configuration with encrypted credentials.

**Location:** `src/db/schema/main.ts`

```typescript
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),

  // Encrypted sensitive data (AES-256-GCM format: iv:authTag:ciphertext)
  encryptedDatabaseUrl: text('encrypted_database_url').notNull(),
  encryptedServiceKey: text('encrypted_service_key'),
  encryptedAnonKey: text('encrypted_anon_key'),
  encryptedLlmApiKey: text('encrypted_llm_api_key'),

  // Non-sensitive display/config
  databaseHost: varchar('database_host', { length: 255 }),
  databaseRegion: varchar('database_region', { length: 50 }),

  // Branding configuration (JSONB)
  branding: jsonb('branding').$type<TenantBranding>(),

  // LLM configuration
  llmProvider: varchar('llm_provider', { length: 50 }).default('openai'),

  // RAG configuration (JSONB)
  ragConfig: jsonb('rag_config').$type<RAGConfig>(),

  // Status
  status: varchar('status', { length: 20 }).default('active'),
  isActive: boolean('is_active').default(true),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

**JSONB Types:**

```typescript
interface TenantBranding {
  primaryColor: string;      // "#3B82F6"
  secondaryColor: string;    // "#1E40AF"
  backgroundColor: string;   // "#FFFFFF"
  textColor: string;         // "#1F2937"
  accentColor: string;       // "#10B981"
  fontFamily: string;        // "Inter, system-ui, sans-serif"
  borderRadius: string;      // "8px"
  logoUrl: string | null;
  customCss: string | null;
}

interface RAGConfig {
  topK: number;              // 5 - chunks to retrieve
  confidenceThreshold: number; // 0.6 - minimum similarity
  chunkSize: number;         // 500 - chars per chunk
  chunkOverlap: number;      // 50 - overlap between chunks
}

type TenantStatus = 'active' | 'suspended' | 'pending' | 'deleted';
```

---

## Tenant Database Schema

Each tenant has an isolated database with the following tables.

**Location:** `src/db/schema/tenant.ts`

### `documents` Table

Stores source documents before chunking.

```typescript
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull(),
  url: varchar('url', { length: 1000 }),

  // Metadata
  docType: varchar('doc_type', { length: 50 }).default('disclosure'),
  fileName: varchar('file_name', { length: 255 }),
  fileSize: integer('file_size'),
  mimeType: varchar('mime_type', { length: 100 }),

  // Processing status
  status: varchar('status', { length: 20 }).default('pending'),
  chunkCount: integer('chunk_count').default(0),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

**Document Types:**
```typescript
type DocumentType = 'disclosure' | 'faq' | 'report' | 'filing' | 'other';
type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error';
```

### `document_chunks` Table

Stores chunked document segments with vector embeddings.

```typescript
export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),

  // pgvector embedding (1536 dimensions for OpenAI text-embedding-3-small)
  embedding: vector('embedding', { dimensions: 1536 }),

  // Position tracking
  chunkIndex: integer('chunk_index').notNull(),
  startChar: integer('start_char'),
  endChar: integer('end_char'),
  tokenCount: integer('token_count'),

  // Denormalized for faster retrieval
  docTitle: varchar('doc_title', { length: 500 }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

**Custom pgvector Type:**
```typescript
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});
```

### `qa_logs` Table

Audit log for all Q&A interactions.

```typescript
export const qaLogs = pgTable('qa_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),

  // Citations (JSONB array)
  citations: jsonb('citations').$type<Citation[]>().default([]),

  // Quality metrics
  confidence: real('confidence').notNull().default(0),
  retrievalScores: jsonb('retrieval_scores').$type<number[]>(),

  // Review workflow
  flagged: boolean('flagged').default(false),
  flaggedAt: timestamp('flagged_at', { withTimezone: true }),
  flaggedReason: varchar('flagged_reason', { length: 500 }),
  reviewed: boolean('reviewed').default(false),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewerNotes: text('reviewer_notes'),

  // Debug info (JSONB)
  debugInfo: jsonb('debug_info').$type<DebugInfo>().default({}),

  // Request metadata
  userAgent: varchar('user_agent', { length: 500 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  sessionId: varchar('session_id', { length: 100 }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

**JSONB Types:**
```typescript
interface Citation {
  docId: string;
  title: string;
  chunkId: string;
  snippet: string;
  score: number;
  chunkIndex: number;
}

interface DebugInfo {
  retrievalMs?: number;
  llmMs?: number;
  totalMs?: number;
  model?: string;
  chunksRetrieved?: number;
  promptTokens?: number;
  completionTokens?: number;
}
```

### `settings` Table

Key-value store for tenant-specific settings.

```typescript
export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

---

## Database Indexes

### Main Database
```sql
CREATE UNIQUE INDEX idx_tenants_slug ON tenants(slug);
```

### Tenant Database
```sql
-- documents
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);

-- document_chunks
CREATE INDEX idx_document_chunks_doc_id ON document_chunks(doc_id);

-- IVFFlat index for vector similarity search
CREATE INDEX idx_document_chunks_embedding ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- qa_logs
CREATE INDEX idx_qa_logs_flagged ON qa_logs(flagged);
CREATE INDEX idx_qa_logs_created_at ON qa_logs(created_at DESC);
CREATE INDEX idx_qa_logs_confidence ON qa_logs(confidence);
```

---

## Vector Search Function

```sql
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
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
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

---

## Drizzle Configuration

### Main Database (`drizzle.config.ts`)

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/main.ts',
  out: './drizzle/main',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Tenant Database (`drizzle.tenant.config.ts`)

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/tenant.ts',
  out: './drizzle/tenant',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL!,
  },
});
```

---

## Sample Queries

**Get tenant with decrypted credentials (via TenantService):**
```typescript
const tenant = await tenantService.getTenantWithSecrets('acme-corp');
// Returns: { databaseUrl: 'postgresql://...', llmApiKey: 'sk-...', ... }
```

**Vector similarity search:**
```typescript
const results = await tenantDb.execute(sql`
  SELECT * FROM match_documents(
    ${embedding}::vector,
    0.6,
    5
  )
`);
```

**Recent low-confidence Q&A logs:**
```typescript
const logs = await tenantDb
  .select()
  .from(qaLogs)
  .where(lt(qaLogs.confidence, 0.7))
  .orderBy(desc(qaLogs.createdAt))
  .limit(20);
```

**Flagged responses pending review:**
```typescript
const flagged = await tenantDb
  .select()
  .from(qaLogs)
  .where(and(
    eq(qaLogs.flagged, true),
    eq(qaLogs.reviewed, false)
  ))
  .orderBy(desc(qaLogs.createdAt));
```
