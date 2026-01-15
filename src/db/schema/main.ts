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

// =============================================================================
// Tenants Table
// =============================================================================

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
  ragConfig: jsonb('rag_config').$type<RAGConfig>().default({
    topK: 5,
    confidenceThreshold: 0.6,
    chunkSize: 500,
    chunkOverlap: 50,
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

export type TenantStatus = 'active' | 'suspended' | 'pending' | 'deleted';

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
  topK: 5,
  confidenceThreshold: 0.6,
  chunkSize: 500,
  chunkOverlap: 50,
};
