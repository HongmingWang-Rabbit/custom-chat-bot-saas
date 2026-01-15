/**
 * Tests for TenantService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('@/db', () => ({
  getMainDb: vi.fn(),
  createTenantDb: vi.fn(),
  clearTenantConnection: vi.fn(),
  clearAllTenantConnections: vi.fn(),
  getTenantPoolStats: vi.fn(() => ({ size: 0, tenants: [] })),
}));

vi.mock('@/lib/crypto/encryption', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted:', '')),
}));

vi.mock('@/lib/supabase/provisioning', () => ({
  provisionSupabaseProject: vi.fn(),
  isProvisioningConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/supabase/tenant-migrations', () => ({
  runTenantMigrations: vi.fn(),
}));

import {
  TenantService,
  getTenantService,
  resetTenantService,
  TenantWithSecrets,
} from '../tenant-service';
import {
  getMainDb,
  createTenantDb,
  clearTenantConnection,
  clearAllTenantConnections,
  getTenantPoolStats,
} from '@/db';
import { encrypt, decrypt } from '@/lib/crypto/encryption';
import {
  provisionSupabaseProject,
  isProvisioningConfigured,
} from '@/lib/supabase/provisioning';
import { runTenantMigrations } from '@/lib/supabase/tenant-migrations';

// =============================================================================
// Mock Data
// =============================================================================

const mockTenant = {
  id: 'test-id-123',
  slug: 'test-tenant',
  name: 'Test Tenant',
  encryptedDatabaseUrl: 'encrypted:postgresql://localhost:5432/test',
  encryptedServiceKey: 'encrypted:service-key-123',
  encryptedAnonKey: 'encrypted:anon-key-123',
  encryptedLlmApiKey: 'encrypted:sk-test-key',
  databaseHost: 'localhost.***.db',
  databaseRegion: 'us-east-1',
  branding: {
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    backgroundColor: '#FFFFFF',
    textColor: '#1F2937',
    accentColor: '#10B981',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
    logoUrl: null,
    customCss: null,
  },
  llmProvider: 'openai',
  ragConfig: {
    topK: 5,
    confidenceThreshold: 0.6,
    chunkSize: 500,
    chunkOverlap: 50,
  },
  status: 'active',
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockDbMethods = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([mockTenant]),
  orderBy: vi.fn().mockResolvedValue([mockTenant]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([mockTenant]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

// =============================================================================
// Test Setup
// =============================================================================

describe('TenantService', () => {
  let service: TenantService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    (getMainDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDbMethods);
    (createTenantDb as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (clearTenantConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (clearAllTenantConnections as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // Reset the singleton
    resetTenantService();
    service = new TenantService();
  });

  afterEach(async () => {
    await resetTenantService();
  });

  // ===========================================================================
  // getTenant
  // ===========================================================================

  describe('getTenant', () => {
    it('should return tenant by slug', async () => {
      const result = await service.getTenant('test-tenant');

      expect(result).toEqual(mockTenant);
      expect(mockDbMethods.select).toHaveBeenCalled();
      expect(mockDbMethods.from).toHaveBeenCalled();
      expect(mockDbMethods.where).toHaveBeenCalled();
      expect(mockDbMethods.limit).toHaveBeenCalledWith(1);
    });

    it('should return null if tenant not found', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([]);

      const result = await service.getTenant('non-existent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getTenantById
  // ===========================================================================

  describe('getTenantById', () => {
    it('should return tenant by ID', async () => {
      const result = await service.getTenantById('test-id-123');

      expect(result).toEqual(mockTenant);
      expect(mockDbMethods.limit).toHaveBeenCalledWith(1);
    });

    it('should return null if tenant not found', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([]);

      const result = await service.getTenantById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getTenantWithSecrets
  // ===========================================================================

  describe('getTenantWithSecrets', () => {
    it('should return tenant with decrypted secrets', async () => {
      const result = await service.getTenantWithSecrets('test-tenant');

      expect(result).not.toBeNull();
      expect(result!.databaseUrl).toBe('postgresql://localhost:5432/test');
      expect(result!.serviceKey).toBe('service-key-123');
      expect(result!.anonKey).toBe('anon-key-123');
      expect(result!.llmApiKey).toBe('sk-test-key');
      expect(decrypt).toHaveBeenCalled();
    });

    it('should return null if tenant not found', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([]);

      const result = await service.getTenantWithSecrets('non-existent');

      expect(result).toBeNull();
    });

    it('should return null if decryption fails', async () => {
      (decrypt as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const result = await service.getTenantWithSecrets('test-tenant');

      expect(result).toBeNull();
    });

    it('should handle missing optional encrypted fields', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([
        {
          ...mockTenant,
          encryptedServiceKey: null,
          encryptedAnonKey: null,
          encryptedLlmApiKey: null,
        },
      ]);

      const result = await service.getTenantWithSecrets('test-tenant');

      expect(result).not.toBeNull();
      expect(result!.serviceKey).toBe('');
      expect(result!.anonKey).toBe('');
      expect(result!.llmApiKey).toBeNull();
    });

    it('should use default values for missing branding and ragConfig', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([
        {
          ...mockTenant,
          branding: null,
          ragConfig: null,
          llmProvider: null,
          status: null,
        },
      ]);

      const result = await service.getTenantWithSecrets('test-tenant');

      expect(result).not.toBeNull();
      expect(result!.branding).toBeDefined();
      expect(result!.ragConfig).toBeDefined();
      expect(result!.llmProvider).toBe('openai');
      expect(result!.status).toBe('active');
    });
  });

  // ===========================================================================
  // getTenantDb
  // ===========================================================================

  describe('getTenantDb', () => {
    it('should return tenant database connection', async () => {
      const mockTenantDb = { execute: vi.fn() };
      (createTenantDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTenantDb);

      const result = await service.getTenantDb('test-tenant');

      expect(result).toBe(mockTenantDb);
      expect(createTenantDb).toHaveBeenCalledWith(
        'postgresql://localhost:5432/test',
        'test-tenant'
      );
    });

    it('should return null if tenant not found', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([]);

      const result = await service.getTenantDb('non-existent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // listTenants
  // ===========================================================================

  describe('listTenants', () => {
    it('should return list of active tenants', async () => {
      const result = await service.listTenants();

      expect(result).toEqual([mockTenant]);
      expect(mockDbMethods.orderBy).toHaveBeenCalled();
    });

    it('should return empty array if no tenants', async () => {
      mockDbMethods.orderBy.mockResolvedValueOnce([]);

      const result = await service.listTenants();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // isSlugAvailable
  // ===========================================================================

  describe('isSlugAvailable', () => {
    it('should return true if slug is available', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([]);

      const result = await service.isSlugAvailable('new-tenant');

      expect(result).toBe(true);
    });

    it('should return false if slug is taken', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([{ slug: 'taken-tenant' }]);

      const result = await service.isSlugAvailable('taken-tenant');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // createTenant
  // ===========================================================================

  describe('createTenant', () => {
    it('should create tenant with encrypted credentials', async () => {
      const params = {
        slug: 'new-tenant',
        name: 'New Tenant',
        databaseUrl: 'postgresql://localhost:5432/new',
        serviceKey: 'service-key',
        anonKey: 'anon-key',
        llmApiKey: 'sk-key',
      };

      const result = await service.createTenant(params);

      expect(result).toEqual(mockTenant);
      expect(encrypt).toHaveBeenCalledWith(params.databaseUrl);
      expect(encrypt).toHaveBeenCalledWith(params.serviceKey);
      expect(encrypt).toHaveBeenCalledWith(params.anonKey);
      expect(encrypt).toHaveBeenCalledWith(params.llmApiKey);
      expect(mockDbMethods.insert).toHaveBeenCalled();
    });

    it('should create tenant without optional llmApiKey', async () => {
      const params = {
        slug: 'new-tenant',
        name: 'New Tenant',
        databaseUrl: 'postgresql://localhost:5432/new',
        serviceKey: 'service-key',
        anonKey: 'anon-key',
      };

      await service.createTenant(params);

      expect(encrypt).toHaveBeenCalledTimes(3); // Only db, service, anon
    });

    it('should merge custom branding with defaults', async () => {
      const params = {
        slug: 'new-tenant',
        name: 'New Tenant',
        databaseUrl: 'postgresql://localhost:5432/new',
        serviceKey: 'service-key',
        anonKey: 'anon-key',
        branding: { primaryColor: '#FF0000' },
      };

      await service.createTenant(params);

      expect(mockDbMethods.values).toHaveBeenCalledWith(
        expect.objectContaining({
          branding: expect.objectContaining({
            primaryColor: '#FF0000',
            secondaryColor: '#1E40AF', // default value
          }),
        })
      );
    });
  });

  // ===========================================================================
  // createTenantWithProvisioning
  // ===========================================================================

  describe('createTenantWithProvisioning', () => {
    beforeEach(() => {
      (provisionSupabaseProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        projectId: 'proj-123',
        projectRef: 'test-ref',
        databaseUrl: 'postgresql://db.supabase.co:5432/postgres',
        anonKey: 'anon-key-123',
        serviceKey: 'service-key-123',
        region: 'us-east-1',
      });

      (runTenantMigrations as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        migrationsRun: ['001_init', '002_pgvector'],
        errors: [],
      });
    });

    it('should provision Supabase project and create tenant', async () => {
      const result = await service.createTenantWithProvisioning({
        slug: 'auto-tenant',
        name: 'Auto Tenant',
      });

      expect(result.tenant).toEqual(mockTenant);
      expect(result.supabaseCredentials.projectId).toBe('proj-123');
      expect(result.migrations.success).toBe(true);
      expect(provisionSupabaseProject).toHaveBeenCalledWith('auto-tenant', undefined);
      expect(runTenantMigrations).toHaveBeenCalled();
    });

    it('should pass region to provisioning', async () => {
      await service.createTenantWithProvisioning({
        slug: 'auto-tenant',
        name: 'Auto Tenant',
        region: 'eu-west-1',
      });

      expect(provisionSupabaseProject).toHaveBeenCalledWith('auto-tenant', 'eu-west-1');
    });

    it('should throw if provisioning is not configured', async () => {
      (isProvisioningConfigured as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      await expect(
        service.createTenantWithProvisioning({
          slug: 'auto-tenant',
          name: 'Auto Tenant',
        })
      ).rejects.toThrow('Supabase Management API credentials are not configured');
    });

    it('should continue even if migrations fail', async () => {
      (runTenantMigrations as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        migrationsRun: [],
        errors: ['Migration failed'],
      });

      const result = await service.createTenantWithProvisioning({
        slug: 'auto-tenant',
        name: 'Auto Tenant',
      });

      expect(result.migrations.success).toBe(false);
      expect(result.tenant).toEqual(mockTenant);
    });
  });

  // ===========================================================================
  // updateTenant
  // ===========================================================================

  describe('updateTenant', () => {
    it('should update tenant settings', async () => {
      mockDbMethods.returning.mockResolvedValueOnce([{ ...mockTenant, name: 'Updated' }]);

      const result = await service.updateTenant('test-tenant', {
        name: 'Updated',
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated');
      expect(mockDbMethods.update).toHaveBeenCalled();
      expect(mockDbMethods.set).toHaveBeenCalled();
    });

    it('should return null if tenant not found', async () => {
      mockDbMethods.limit.mockResolvedValueOnce([]);

      const result = await service.updateTenant('non-existent', { name: 'Updated' });

      expect(result).toBeNull();
    });

    it('should merge branding updates', async () => {
      await service.updateTenant('test-tenant', {
        branding: { primaryColor: '#FF0000' },
      });

      expect(mockDbMethods.set).toHaveBeenCalledWith(
        expect.objectContaining({
          branding: expect.objectContaining({
            primaryColor: '#FF0000',
          }),
        })
      );
    });

    it('should merge ragConfig updates', async () => {
      await service.updateTenant('test-tenant', {
        ragConfig: { topK: 10 },
      });

      expect(mockDbMethods.set).toHaveBeenCalledWith(
        expect.objectContaining({
          ragConfig: expect.objectContaining({
            topK: 10,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // updateTenantCredentials
  // ===========================================================================

  describe('updateTenantCredentials', () => {
    it('should update encrypted credentials', async () => {
      await service.updateTenantCredentials('test-tenant', {
        databaseUrl: 'postgresql://new-host:5432/db',
        serviceKey: 'new-service-key',
      });

      expect(encrypt).toHaveBeenCalledWith('postgresql://new-host:5432/db');
      expect(encrypt).toHaveBeenCalledWith('new-service-key');
      expect(clearTenantConnection).toHaveBeenCalledWith('test-tenant');
    });

    it('should only update provided credentials', async () => {
      await service.updateTenantCredentials('test-tenant', {
        llmApiKey: 'new-api-key',
      });

      expect(encrypt).toHaveBeenCalledTimes(1);
      expect(encrypt).toHaveBeenCalledWith('new-api-key');
    });

    it('should invalidate cached connection', async () => {
      await service.updateTenantCredentials('test-tenant', {
        databaseUrl: 'postgresql://new-host:5432/db',
      });

      expect(clearTenantConnection).toHaveBeenCalledWith('test-tenant');
    });
  });

  // ===========================================================================
  // deleteTenant
  // ===========================================================================

  describe('deleteTenant', () => {
    it('should soft delete tenant', async () => {
      await service.deleteTenant('test-tenant');

      expect(mockDbMethods.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'deleted',
        })
      );
      expect(clearTenantConnection).toHaveBeenCalledWith('test-tenant');
    });
  });

  // ===========================================================================
  // Pool Management
  // ===========================================================================

  describe('clearFromPool', () => {
    it('should clear tenant from connection pool', async () => {
      await service.clearFromPool('test-tenant');

      expect(clearTenantConnection).toHaveBeenCalledWith('test-tenant');
    });
  });

  describe('clearPool', () => {
    it('should clear all cached connections', async () => {
      await service.clearPool();

      expect(clearAllTenantConnections).toHaveBeenCalled();
    });
  });

  describe('getPoolStats', () => {
    it('should return pool statistics', () => {
      (getTenantPoolStats as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        size: 3,
        tenants: ['tenant-a', 'tenant-b', 'tenant-c'],
      });

      const stats = service.getPoolStats();

      expect(stats.size).toBe(3);
      expect(stats.tenants).toHaveLength(3);
    });
  });
});

// =============================================================================
// Singleton Tests
// =============================================================================

describe('getTenantService', () => {
  beforeEach(async () => {
    await resetTenantService();
  });

  it('should return singleton instance', () => {
    const instance1 = getTenantService();
    const instance2 = getTenantService();

    expect(instance1).toBe(instance2);
  });
});

describe('resetTenantService', () => {
  it('should clear singleton and pool', async () => {
    const instance1 = getTenantService();
    await resetTenantService();
    const instance2 = getTenantService();

    expect(instance1).not.toBe(instance2);
  });
});
