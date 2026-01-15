/**
 * Tests for Tenant Database Migrations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock postgres module using vi.hoisted
// =============================================================================

const mockUnsafe = vi.fn();
const mockEnd = vi.fn();
const mockTaggedTemplate = vi.fn();

vi.mock('postgres', () => {
  return {
    default: vi.fn(() => {
      const client = Object.assign(mockTaggedTemplate, {
        unsafe: mockUnsafe,
        end: mockEnd,
      });
      return client;
    }),
  };
});

// Import after mock setup
import { runTenantMigrations, verifyTenantSchema } from '../tenant-migrations';

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockUnsafe.mockResolvedValue([]);
  mockEnd.mockResolvedValue(undefined);
  mockTaggedTemplate.mockResolvedValue([]);
});

// =============================================================================
// runTenantMigrations Tests
// =============================================================================

describe('runTenantMigrations', () => {
  const testDatabaseUrl = 'postgresql://user:pass@localhost:5432/testdb';

  it('should run all migrations successfully', async () => {
    const result = await runTenantMigrations(testDatabaseUrl);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Should have run all migrations
    expect(result.migrationsRun).toContain('pgvector_extension');
    expect(result.migrationsRun).toContain('documents_table');
    expect(result.migrationsRun).toContain('document_chunks_table');
    expect(result.migrationsRun).toContain('qa_logs_table');
    expect(result.migrationsRun).toContain('settings_table');
    expect(result.migrationsRun).toContain('match_documents_function');
  });

  it('should close connection after migrations', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should execute migrations in correct order', async () => {
    const executionOrder: string[] = [];

    mockUnsafe.mockImplementation((sql: string) => {
      if (sql.includes('CREATE EXTENSION')) {
        executionOrder.push('pgvector');
      } else if (sql.includes('CREATE TABLE IF NOT EXISTS documents (')) {
        executionOrder.push('documents');
      } else if (sql.includes('CREATE TABLE IF NOT EXISTS document_chunks')) {
        executionOrder.push('document_chunks');
      } else if (sql.includes('CREATE TABLE IF NOT EXISTS qa_logs')) {
        executionOrder.push('qa_logs');
      } else if (sql.includes('CREATE TABLE IF NOT EXISTS settings')) {
        executionOrder.push('settings');
      } else if (sql.includes('ivfflat')) {
        executionOrder.push('vector_index');
      } else if (sql.includes('CREATE OR REPLACE FUNCTION')) {
        executionOrder.push('match_function');
      }
      return Promise.resolve([]);
    });

    await runTenantMigrations(testDatabaseUrl);

    // Verify order: extension first, then tables
    expect(executionOrder.indexOf('pgvector')).toBeLessThan(
      executionOrder.indexOf('documents')
    );
    expect(executionOrder.indexOf('documents')).toBeLessThan(
      executionOrder.indexOf('document_chunks')
    );
  });

  it('should handle pgvector extension creation', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE EXTENSION IF NOT EXISTS vector')
    );
  });

  it('should create documents table with correct schema', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS documents.*id UUID PRIMARY KEY/s)
    );
  });

  it('should create document_chunks table with vector column', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS document_chunks.*embedding vector\(1536\)/s)
    );
  });

  it('should create match_documents function', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE OR REPLACE FUNCTION match_documents/s)
    );
  });

  it('should handle migration failure gracefully', async () => {
    mockUnsafe
      .mockResolvedValueOnce([]) // pgvector succeeds
      .mockRejectedValueOnce(new Error('Database connection lost')); // documents fails

    const result = await runTenantMigrations(testDatabaseUrl);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Database connection lost');
    expect(result.migrationsRun).toContain('pgvector_extension');
  });

  it('should continue when vector index creation fails (deferred)', async () => {
    // Make index creation fail (common when table is empty)
    mockUnsafe.mockImplementation((sql: string) => {
      if (sql.includes('ivfflat')) {
        return Promise.reject(new Error('cannot create index on empty table'));
      }
      return Promise.resolve([]);
    });

    const result = await runTenantMigrations(testDatabaseUrl);

    // Should still succeed - index creation failure is expected
    expect(result.success).toBe(true);
    expect(result.migrationsRun).not.toContain('vector_index');
  });

  it('should close connection even on failure', async () => {
    mockUnsafe.mockRejectedValue(new Error('Connection error'));

    await runTenantMigrations(testDatabaseUrl);

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should track duration correctly', async () => {
    const result = await runTenantMigrations(testDatabaseUrl);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe('number');
  });

  it('should create qa_logs table with review workflow columns', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS qa_logs.*flagged BOOLEAN/s)
    );
  });

  it('should create settings table', async () => {
    await runTenantMigrations(testDatabaseUrl);

    expect(mockUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS settings.*key VARCHAR/s)
    );
  });
});

// =============================================================================
// verifyTenantSchema Tests
// =============================================================================

describe('verifyTenantSchema', () => {
  const testDatabaseUrl = 'postgresql://user:pass@localhost:5432/testdb';

  it('should return valid when all tables exist', async () => {
    mockTaggedTemplate.mockResolvedValueOnce([
      { table_name: 'documents' },
      { table_name: 'document_chunks' },
      { table_name: 'qa_logs' },
      { table_name: 'settings' },
    ]);

    const result = await verifyTenantSchema(testDatabaseUrl);

    expect(result.valid).toBe(true);
    expect(result.missingTables).toHaveLength(0);
  });

  it('should return invalid when tables are missing', async () => {
    mockTaggedTemplate.mockResolvedValueOnce([
      { table_name: 'documents' },
      { table_name: 'document_chunks' },
      // qa_logs and settings missing
    ]);

    const result = await verifyTenantSchema(testDatabaseUrl);

    expect(result.valid).toBe(false);
    expect(result.missingTables).toContain('qa_logs');
    expect(result.missingTables).toContain('settings');
  });

  it('should return invalid when no tables exist', async () => {
    mockTaggedTemplate.mockResolvedValueOnce([]);

    const result = await verifyTenantSchema(testDatabaseUrl);

    expect(result.valid).toBe(false);
    expect(result.missingTables).toHaveLength(4);
    expect(result.missingTables).toContain('documents');
    expect(result.missingTables).toContain('document_chunks');
    expect(result.missingTables).toContain('qa_logs');
    expect(result.missingTables).toContain('settings');
  });

  it('should close connection after verification', async () => {
    mockTaggedTemplate.mockResolvedValueOnce([]);

    await verifyTenantSchema(testDatabaseUrl);

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should identify specific missing tables', async () => {
    mockTaggedTemplate.mockResolvedValueOnce([
      { table_name: 'documents' },
      { table_name: 'settings' },
    ]);

    const result = await verifyTenantSchema(testDatabaseUrl);

    expect(result.valid).toBe(false);
    expect(result.missingTables).toContain('document_chunks');
    expect(result.missingTables).toContain('qa_logs');
    expect(result.missingTables).not.toContain('documents');
    expect(result.missingTables).not.toContain('settings');
  });
});
