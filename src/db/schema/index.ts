/**
 * Schema exports for Drizzle ORM.
 */

// Main database schema (tenant metadata)
export * from './main';

// Tenant database schema (documents, chunks, qa_logs)
export * from './tenant';
