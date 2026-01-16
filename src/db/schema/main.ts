/**
 * Main Database Schema (Drizzle ORM)
 *
 * This schema defines the tenants table in the main/central database.
 * Each tenant has encrypted credentials for their dedicated database.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Schema default values for RAG config (must match values in @/lib/rag/config.ts)
// Defined inline to avoid circular dependency: schema -> config -> schema
// NOTE: These defaults are for NEW tenants. Existing tenants may have old values,
// but RAGService overrides topK and confidenceThreshold with system defaults anyway.
const SCHEMA_DEFAULT_TOP_K = 25;
const SCHEMA_DEFAULT_CONFIDENCE_THRESHOLD = 0.25;
const SCHEMA_DEFAULT_CHUNK_SIZE = 500;
const SCHEMA_DEFAULT_CHUNK_OVERLAP = 50;

// =============================================================================
// Tenants Table
// =============================================================================

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),

  // Encrypted sensitive data (AES-256-GCM format: iv:authTag:ciphertext)
  encryptedDatabaseUrl: text('encrypted_database_url'),
  encryptedServiceKey: text('encrypted_service_key'),
  encryptedAnonKey: text('encrypted_anon_key'),
  encryptedLlmApiKey: text('encrypted_llm_api_key'),

  // Provisioning state (for recovery if provisioning fails partway)
  supabaseProjectRef: varchar('supabase_project_ref', { length: 100 }),
  encryptedDbPassword: text('encrypted_db_password'), // Stored during provisioning for recovery

  // Non-sensitive display/config
  databaseHost: varchar('database_host', { length: 255 }),
  databaseRegion: varchar('database_region', { length: 50 }),

  // Branding configuration (JSONB)
  branding: jsonb('branding').$type<TenantBranding>().default({
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    backgroundColor: '#FFFFFF',
    textColor: '#1F2937',
    accentColor: '#10B981',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
    logoUrl: null,
    customCss: null,
  }),

  // LLM configuration
  llmProvider: varchar('llm_provider', { length: 50 }).default('openai'),

  // RAG configuration (JSONB)
  // Note: confidenceThreshold for hybrid RRF scoring (0.5 = rank #1 in vector search only)
  ragConfig: jsonb('rag_config').$type<RAGConfig>().default({
    topK: SCHEMA_DEFAULT_TOP_K,
    confidenceThreshold: SCHEMA_DEFAULT_CONFIDENCE_THRESHOLD,
    chunkSize: SCHEMA_DEFAULT_CHUNK_SIZE,
    chunkOverlap: SCHEMA_DEFAULT_CHUNK_OVERLAP,
  }),

  // Status
  status: varchar('status', { length: 20 }).default('active').$type<TenantStatus>(),
  isActive: boolean('is_active').default(true),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Types (inferred from schema)
// =============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

// JSON field types
export interface TenantBranding {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: string;
  logoUrl: string | null;
  customCss: string | null;
}

export interface RAGConfig {
  topK: number;
  confidenceThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
}

export type TenantStatus = 'active' | 'suspended' | 'pending' | 'deleted' | 'provisioning' | 'error';

// Default values
export const DEFAULT_BRANDING: TenantBranding = {
  primaryColor: '#3B82F6',
  secondaryColor: '#1E40AF',
  backgroundColor: '#FFFFFF',
  textColor: '#1F2937',
  accentColor: '#10B981',
  fontFamily: 'Inter, system-ui, sans-serif',
  borderRadius: '8px',
  logoUrl: null,
  customCss: null,
};

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  topK: SCHEMA_DEFAULT_TOP_K,
  confidenceThreshold: SCHEMA_DEFAULT_CONFIDENCE_THRESHOLD,
  chunkSize: SCHEMA_DEFAULT_CHUNK_SIZE,
  chunkOverlap: SCHEMA_DEFAULT_CHUNK_OVERLAP,
};
