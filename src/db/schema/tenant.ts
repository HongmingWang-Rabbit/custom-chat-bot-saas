/**
 * Tenant Database Schema (Drizzle ORM)
 *
 * This schema is used for each tenant's dedicated database.
 * Contains: documents, document_chunks, qa_logs, settings
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// =============================================================================
// Custom Type: pgvector
// =============================================================================

/**
 * Custom type for pgvector embeddings.
 * Stores vectors as float arrays, serializes to/from pgvector format.
 */
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
    // Parse pgvector format: [0.1,0.2,0.3,...]
    return value
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
});

// =============================================================================
// Documents Table
// =============================================================================

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull(),
  url: varchar('url', { length: 1000 }),

  // Metadata
  docType: varchar('doc_type', { length: 50 }).default('disclosure').$type<DocumentType>(),
  fileName: varchar('file_name', { length: 255 }),
  fileSize: integer('file_size'),
  mimeType: varchar('mime_type', { length: 100 }),

  // Storage (Supabase Storage)
  storageKey: varchar('storage_key', { length: 500 }), // Object path in tenant's storage bucket

  // Processing status
  status: varchar('status', { length: 20 }).default('pending').$type<DocumentStatus>(),
  chunkCount: integer('chunk_count').default(0),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('idx_documents_status').on(table.status),
  createdAtIdx: index('idx_documents_created_at').on(table.createdAt),
}));

// =============================================================================
// Document Chunks Table
// =============================================================================

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

  // Timestamp
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  docIdIdx: index('idx_document_chunks_doc_id').on(table.docId),
  // Note: IVFFlat index for vector search is created via raw SQL migration
}));

// =============================================================================
// QA Logs Table
// =============================================================================

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
  ipAddress: varchar('ip_address', { length: 45 }), // Supports IPv6
  sessionId: varchar('session_id', { length: 100 }),

  // Timestamp
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  flaggedIdx: index('idx_qa_logs_flagged').on(table.flagged),
  createdAtIdx: index('idx_qa_logs_created_at').on(table.createdAt),
  confidenceIdx: index('idx_qa_logs_confidence').on(table.confidence),
}));

// =============================================================================
// Settings Table (key-value store for tenant settings)
// =============================================================================

export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Relations
// =============================================================================

export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.docId],
    references: [documents.id],
  }),
}));

// =============================================================================
// Types (inferred from schema)
// =============================================================================

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

export type QALog = typeof qaLogs.$inferSelect;
export type NewQALog = typeof qaLogs.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

// Enum types
export type DocumentType = 'disclosure' | 'faq' | 'report' | 'filing' | 'other';
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error';

// JSON field types
export interface Citation {
  docId: string;
  title: string;
  chunkId: string;
  snippet: string;
  score: number;
  chunkIndex: number;
}

export interface DebugInfo {
  retrievalMs?: number;
  llmMs?: number;
  totalMs?: number;
  model?: string;
  chunksRetrieved?: number;
  promptTokens?: number;
  completionTokens?: number;
}
