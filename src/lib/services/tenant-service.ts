/**
 * Tenant Service
 *
 * Manages tenant data and database connections using Drizzle ORM.
 * Features:
 * - Encrypts/decrypts sensitive credentials
 * - Caches tenant database connections
 * - Type-safe queries with Drizzle
 */

import { eq, and, or } from 'drizzle-orm';
import { decrypt, encrypt } from '@/lib/crypto/encryption';
import {
  getMainDb,
  createTenantDb,
  clearTenantConnection,
  clearAllTenantConnections,
  getTenantPoolStats,
  MainDatabase,
  TenantDatabase,
} from '@/db';
import {
  tenants,
  Tenant,
  NewTenant,
  TenantBranding,
  TenantStatus,
  RAGConfig,
  DEFAULT_BRANDING,
  DEFAULT_RAG_CONFIG,
} from '@/db/schema/main';
import {
  provisionSupabaseProject,
  deleteSupabaseProject,
  isProvisioningConfigured,
  generateSecurePassword,
  SupabaseCredentials,
} from '@/lib/supabase/provisioning';
import { runTenantMigrations, MigrationResult } from '@/lib/supabase/tenant-migrations';
import { logger } from '@/lib/logger';
import { createStorageService, StorageService } from './storage-service';

// Create a child logger for tenant service
const log = logger.child({ layer: 'service', service: 'TenantService' });

// =============================================================================
// Types
// =============================================================================

/**
 * Tenant with decrypted secrets.
 * Use sparingly - only when database access is needed.
 */
export interface TenantWithSecrets {
  id: string;
  slug: string;
  name: string;
  databaseHost: string | null;
  databaseRegion: string | null;
  branding: TenantBranding;
  llmProvider: string;
  ragConfig: RAGConfig;
  status: string;
  createdAt: Date | null;
  updatedAt: Date | null;

  // Decrypted secrets
  databaseUrl: string;
  serviceKey: string;
  anonKey: string;
  llmApiKey: string | null;
}

/**
 * Result from automated tenant provisioning.
 */
export interface ProvisioningResult {
  tenant: Tenant;
  supabaseCredentials: SupabaseCredentials;
  migrations: MigrationResult;
}

// =============================================================================
// Tenant Service Class
// =============================================================================

export class TenantService {
  private mainDb: MainDatabase;

  constructor() {
    this.mainDb = getMainDb();
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Get tenant by slug (without secrets).
   * Safe to use for public data access.
   */
  async getTenant(slug: string): Promise<Tenant | null> {
    const result = await this.mainDb
      .select()
      .from(tenants)
      .where(
        and(
          eq(tenants.slug, slug),
          eq(tenants.status, 'active')
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get tenant by slug regardless of status.
   * Use for checking provisioning status or admin operations.
   */
  async getTenantAnyStatus(slug: string): Promise<Tenant | null> {
    const result = await this.mainDb
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get tenant by ID.
   */
  async getTenantById(id: string): Promise<Tenant | null> {
    const result = await this.mainDb
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get tenant with decrypted secrets.
   * Use sparingly - only when database access is needed.
   */
  async getTenantWithSecrets(slug: string): Promise<TenantWithSecrets | null> {
    const tenant = await this.getTenant(slug);
    if (!tenant) return null;

    // Database URL is required for a functioning tenant
    if (!tenant.encryptedDatabaseUrl) {
      log.warn({ event: 'missing_database_url', slug }, 'Tenant has no encrypted database URL');
      return null;
    }

    try {
      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        databaseHost: tenant.databaseHost,
        databaseRegion: tenant.databaseRegion,
        branding: tenant.branding ?? DEFAULT_BRANDING,
        llmProvider: tenant.llmProvider ?? 'openai',
        ragConfig: tenant.ragConfig ?? DEFAULT_RAG_CONFIG,
        status: tenant.status ?? 'active',
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,

        // Decrypt secrets
        databaseUrl: decrypt(tenant.encryptedDatabaseUrl),
        serviceKey: tenant.encryptedServiceKey
          ? decrypt(tenant.encryptedServiceKey)
          : '',
        anonKey: tenant.encryptedAnonKey
          ? decrypt(tenant.encryptedAnonKey)
          : '',
        llmApiKey: tenant.encryptedLlmApiKey
          ? decrypt(tenant.encryptedLlmApiKey)
          : null,
      };
    } catch (error) {
      log.error({ event: 'decrypt_error', slug, error: error instanceof Error ? error.message : String(error) }, 'Failed to decrypt secrets');
      return null;
    }
  }

  /**
   * Get a Drizzle client for a tenant's database.
   * Uses connection pooling to avoid repeated decryption.
   */
  async getTenantDb(slug: string): Promise<TenantDatabase | null> {
    const tenant = await this.getTenantWithSecrets(slug);
    if (!tenant) return null;

    return createTenantDb(tenant.databaseUrl, slug);
  }

  /**
   * Get a storage service for a tenant's Supabase Storage.
   * Returns null if tenant not found or storage not configured.
   */
  async getStorageService(slug: string): Promise<StorageService | null> {
    const tenant = await this.getTenantWithSecrets(slug);
    if (!tenant || !tenant.serviceKey) {
      log.warn({ event: 'storage_unavailable', slug }, 'Storage service unavailable');
      return null;
    }

    // Extract project ref from database URL
    // URL format: postgresql://postgres.{projectRef}:password@host:port/db
    const projectRef = this.extractProjectRef(tenant.databaseUrl);
    if (!projectRef) {
      log.warn({ event: 'storage_no_project_ref', slug }, 'Cannot determine project ref');
      return null;
    }

    const apiUrl = `https://${projectRef}.supabase.co`;
    return createStorageService(apiUrl, tenant.serviceKey);
  }

  /**
   * Extract Supabase project reference from database URL.
   * Database URL username format: postgres.{projectRef}
   */
  private extractProjectRef(databaseUrl: string): string | null {
    try {
      const url = new URL(databaseUrl);
      // Username format: postgres.{projectRef}
      const username = url.username;
      const parts = username.split('.');
      if (parts.length >= 2 && parts[0] === 'postgres') {
        return parts[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * List all tenants (without secrets).
   * Includes 'active', 'provisioning', and 'error' status tenants.
   * Excludes 'deleted' tenants.
   */
  async listTenants(): Promise<Tenant[]> {
    return this.mainDb
      .select()
      .from(tenants)
      .where(
        or(
          eq(tenants.status, 'active'),
          eq(tenants.status, 'provisioning'),
          eq(tenants.status, 'error')
        )
      )
      .orderBy(tenants.createdAt);
  }

  /**
   * Check if a tenant slug is available.
   */
  async isSlugAvailable(slug: string): Promise<boolean> {
    const result = await this.mainDb
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    return result.length === 0;
  }

  // ===========================================================================
  // Provisioning State Management
  // ===========================================================================

  /**
   * Create or get a provisional tenant record for provisioning recovery.
   * If a record exists in 'provisioning' status, returns the stored password.
   * Otherwise creates a new provisional record.
   *
   * @returns The database password (new or recovered) and whether this is a recovery
   */
  async getOrCreateProvisioningState(
    slug: string,
    name: string,
    generatePassword: () => string
  ): Promise<{ dbPassword: string; isRecovery: boolean; projectRef: string | null }> {
    // Check for existing provisional tenant
    const existing = await this.getTenantAnyStatus(slug);

    if (existing) {
      // If it's in provisioning state, recover the password
      if (existing.status === 'provisioning' && existing.encryptedDbPassword) {
        try {
          const dbPassword = decrypt(existing.encryptedDbPassword);
          log.info(
            { event: 'provisioning_recovery', slug, projectRef: existing.supabaseProjectRef },
            'Recovering provisioning state from previous attempt'
          );
          return {
            dbPassword,
            isRecovery: true,
            projectRef: existing.supabaseProjectRef,
          };
        } catch (error) {
          log.warn(
            { event: 'provisioning_recovery_failed', slug, error: error instanceof Error ? error.message : String(error) },
            'Could not decrypt stored password, creating new provisioning state'
          );
        }
      }

      // If it exists in another status, it's a conflict
      if (existing.status === 'active') {
        throw new Error(`Tenant with slug "${slug}" already exists`);
      }

      // For other statuses (error, deleted), delete and recreate
      log.info({ event: 'provisioning_cleanup', slug, status: existing.status }, 'Cleaning up old tenant record');
      await this.mainDb.delete(tenants).where(eq(tenants.slug, slug));
    }

    // Generate new password and create provisional record
    const dbPassword = generatePassword();

    await this.mainDb.insert(tenants).values({
      slug,
      name,
      status: 'provisioning',
      encryptedDbPassword: encrypt(dbPassword),
    });

    log.info({ event: 'provisioning_state_created', slug }, 'Created provisional tenant record');

    return {
      dbPassword,
      isRecovery: false,
      projectRef: null,
    };
  }

  /**
   * Update provisioning state with Supabase project reference.
   * Called after project creation to enable recovery if later steps fail.
   */
  async updateProvisioningProjectRef(slug: string, projectRef: string): Promise<void> {
    await this.mainDb
      .update(tenants)
      .set({ supabaseProjectRef: projectRef, updatedAt: new Date() })
      .where(eq(tenants.slug, slug));

    log.debug({ event: 'provisioning_project_ref', slug, projectRef }, 'Updated project reference');
  }

  /**
   * Complete provisioning by updating the provisional record with full credentials.
   */
  async completeProvisioning(
    slug: string,
    credentials: {
      databaseUrl: string;
      serviceKey: string;
      anonKey: string;
      llmApiKey?: string;
    },
    branding?: Partial<TenantBranding>,
    ragConfig?: Partial<RAGConfig>
  ): Promise<Tenant> {
    const result = await this.mainDb
      .update(tenants)
      .set({
        encryptedDatabaseUrl: encrypt(credentials.databaseUrl),
        encryptedServiceKey: encrypt(credentials.serviceKey),
        encryptedAnonKey: encrypt(credentials.anonKey),
        encryptedLlmApiKey: credentials.llmApiKey ? encrypt(credentials.llmApiKey) : null,
        databaseHost: this.maskHost(credentials.databaseUrl),
        branding: { ...DEFAULT_BRANDING, ...branding },
        ragConfig: { ...DEFAULT_RAG_CONFIG, ...ragConfig },
        status: 'active',
        // Clear provisioning-only fields
        encryptedDbPassword: null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.slug, slug))
      .returning();

    log.info({ event: 'provisioning_completed', slug }, 'Provisioning completed successfully');

    return result[0];
  }

  /**
   * Mark provisioning as failed.
   */
  async failProvisioning(slug: string, errorMessage: string): Promise<void> {
    await this.mainDb
      .update(tenants)
      .set({
        status: 'error',
        updatedAt: new Date(),
      })
      .where(eq(tenants.slug, slug));

    log.error({ event: 'provisioning_failed', slug, error: errorMessage }, 'Provisioning failed');
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Create a new tenant with encrypted credentials.
   */
  async createTenant(params: {
    slug: string;
    name: string;
    databaseUrl: string;
    serviceKey: string;
    anonKey: string;
    llmApiKey?: string;
    branding?: Partial<TenantBranding>;
    ragConfig?: Partial<RAGConfig>;
    status?: TenantStatus;
    supabaseProjectRef?: string;
  }): Promise<Tenant> {
    const newTenant: NewTenant = {
      slug: params.slug,
      name: params.name,
      encryptedDatabaseUrl: encrypt(params.databaseUrl),
      encryptedServiceKey: encrypt(params.serviceKey),
      encryptedAnonKey: encrypt(params.anonKey),
      encryptedLlmApiKey: params.llmApiKey ? encrypt(params.llmApiKey) : null,
      databaseHost: this.maskHost(params.databaseUrl),
      branding: { ...DEFAULT_BRANDING, ...params.branding },
      ragConfig: { ...DEFAULT_RAG_CONFIG, ...params.ragConfig },
      status: params.status ?? 'active',
      supabaseProjectRef: params.supabaseProjectRef,
    };

    const result = await this.mainDb
      .insert(tenants)
      .values(newTenant)
      .returning();

    log.info({ event: 'tenant_created', slug: params.slug }, 'Tenant created');

    return result[0];
  }

  /**
   * Create a new tenant with automatic Supabase project provisioning.
   *
   * This method supports recovery from partial failures:
   * 1. Stores password before creating project (enables recovery)
   * 2. Creates a new Supabase project (or reuses existing on recovery)
   * 3. Waits for the project to be ready
   * 4. Runs database migrations (pgvector, tables, indexes)
   * 5. Completes the tenant record with full credentials
   *
   * @param params - Tenant creation parameters
   * @returns ProvisioningResult with tenant, credentials, and migration status
   * @throws Error if Supabase credentials are not configured
   */
  async createTenantWithProvisioning(params: {
    slug: string;
    name: string;
    llmApiKey?: string;
    branding?: Partial<TenantBranding>;
    ragConfig?: Partial<RAGConfig>;
    region?: string;
  }): Promise<ProvisioningResult> {
    // Step 1: Check if Supabase provisioning is configured
    if (!isProvisioningConfigured()) {
      const error = new Error(
        `Cannot create tenant "${params.slug}": ` +
          `Supabase Management API credentials are not configured. ` +
          `Set SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_ID environment variables. ` +
          `Get access token from: https://supabase.com/dashboard/account/tokens`
      );
      log.error({ event: 'provisioning_not_configured', slug: params.slug }, error.message);
      throw error;
    }

    log.info({ event: 'provisioning_start', slug: params.slug }, 'Starting automated provisioning');
    const startTime = Date.now();

    try {
      // Step 2: Get or create provisioning state (stores password for recovery)
      const { dbPassword, isRecovery, projectRef: existingProjectRef } =
        await this.getOrCreateProvisioningState(
          params.slug,
          params.name,
          generateSecurePassword
        );

      if (isRecovery) {
        log.info({ event: 'provisioning_recovery', slug: params.slug, projectRef: existingProjectRef }, 'Recovering from previous attempt');
      }

      // Step 3: Provision the Supabase project
      log.debug({ event: 'supabase_provisioning', slug: params.slug }, 'Provisioning Supabase project');
      const supabaseCredentials = await provisionSupabaseProject(params.slug, {
        region: params.region,
        dbPassword,
        existingProjectRef: existingProjectRef ?? undefined,
        onProjectCreated: async (projectRef) => {
          // Save project ref immediately so we can recover if later steps fail
          await this.updateProvisioningProjectRef(params.slug, projectRef);
        },
      });

      // Step 4: Run tenant database migrations
      log.debug({ event: 'migrations_start', slug: params.slug }, 'Running database migrations');
      const migrations = await runTenantMigrations(supabaseCredentials.databaseUrl);

      if (!migrations.success) {
        log.error(
          { event: 'migrations_failed', slug: params.slug, errors: migrations.errors },
          'Migrations failed'
        );
        // Continue anyway - tenant can be created, migrations can be retried
      }

      // Step 5: Complete provisioning with full credentials
      log.debug({ event: 'completing_provisioning', slug: params.slug }, 'Completing tenant record');
      const tenant = await this.completeProvisioning(
        params.slug,
        {
          databaseUrl: supabaseCredentials.databaseUrl,
          serviceKey: supabaseCredentials.serviceKey,
          anonKey: supabaseCredentials.anonKey,
          llmApiKey: params.llmApiKey,
        },
        params.branding,
        params.ragConfig
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.info(
        { event: 'provisioning_complete', slug: params.slug, elapsed_s: parseFloat(elapsed) },
        `Successfully provisioned tenant in ${elapsed}s`
      );

      return {
        tenant,
        supabaseCredentials,
        migrations,
      };
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.error(
        { event: 'provisioning_failed', slug: params.slug, elapsed_s: parseFloat(elapsed), error: error instanceof Error ? error.message : String(error) },
        `Failed to provision tenant after ${elapsed}s`
      );
      throw error;
    }
  }

  /**
   * Update tenant's non-sensitive settings.
   */
  async updateTenant(
    slug: string,
    updates: {
      name?: string;
      branding?: Partial<TenantBranding>;
      llmProvider?: string;
      ragConfig?: Partial<RAGConfig>;
      status?: TenantStatus;
    }
  ): Promise<Tenant | null> {
    // Get existing tenant to merge partial updates (any status)
    const existing = await this.getTenantAnyStatus(slug);
    if (!existing) return null;

    const updateData: Partial<Tenant> = {
      updatedAt: new Date(),
    };

    if (updates.name) updateData.name = updates.name;
    if (updates.llmProvider) updateData.llmProvider = updates.llmProvider;
    if (updates.status) updateData.status = updates.status;
    if (updates.branding) {
      updateData.branding = {
        ...(existing.branding ?? DEFAULT_BRANDING),
        ...updates.branding,
      };
    }
    if (updates.ragConfig) {
      updateData.ragConfig = {
        ...(existing.ragConfig ?? DEFAULT_RAG_CONFIG),
        ...updates.ragConfig,
      };
    }

    const result = await this.mainDb
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.slug, slug))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Update tenant status directly (for background processes).
   * Unlike updateTenant, this works on tenants in any status.
   */
  async updateTenantStatus(slug: string, status: TenantStatus): Promise<Tenant | null> {
    const result = await this.mainDb
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.slug, slug))
      .returning();

    if (result[0]) {
      log.info({ event: 'tenant_status_updated', slug, status }, `Tenant status updated to ${status}`);
    }

    return result[0] ?? null;
  }

  /**
   * Update tenant's encrypted credentials.
   */
  async updateTenantCredentials(
    slug: string,
    credentials: {
      databaseUrl?: string;
      serviceKey?: string;
      anonKey?: string;
      llmApiKey?: string;
    }
  ): Promise<void> {
    const updateData: Partial<NewTenant> = {
      updatedAt: new Date(),
    };

    if (credentials.databaseUrl) {
      updateData.encryptedDatabaseUrl = encrypt(credentials.databaseUrl);
      updateData.databaseHost = this.maskHost(credentials.databaseUrl);
    }
    if (credentials.serviceKey) {
      updateData.encryptedServiceKey = encrypt(credentials.serviceKey);
    }
    if (credentials.anonKey) {
      updateData.encryptedAnonKey = encrypt(credentials.anonKey);
    }
    if (credentials.llmApiKey) {
      updateData.encryptedLlmApiKey = encrypt(credentials.llmApiKey);
    }

    await this.mainDb
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.slug, slug));

    // Invalidate cached connection
    await clearTenantConnection(slug);

    log.info({ event: 'credentials_updated', slug }, 'Tenant credentials updated');
  }

  /**
   * Soft delete a tenant (set status to 'deleted').
   */
  async deleteTenant(slug: string): Promise<void> {
    await this.mainDb
      .update(tenants)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(tenants.slug, slug));

    await clearTenantConnection(slug);

    log.info({ event: 'tenant_deleted', slug }, 'Tenant deleted');
  }

  /**
   * Hard delete a tenant - permanently removes:
   * - Supabase project (database + storage)
   * - Tenant record from main database
   *
   * This is IRREVERSIBLE. Use with caution.
   *
   * @param slug - Tenant slug to delete
   * @param options.skipSupabaseDelete - Skip Supabase project deletion (useful if already deleted manually)
   * @returns Object with deletion details
   */
  async hardDeleteTenant(
    slug: string,
    options: { skipSupabaseDelete?: boolean } = {}
  ): Promise<{ tenantDeleted: boolean; supabaseDeleted: boolean; projectRef: string | null }> {
    log.info({ event: 'hard_delete_start', slug }, `Starting hard delete for tenant: ${slug}`);

    // Get tenant with secrets to extract project ref
    const tenant = await this.getTenantAnyStatus(slug);
    if (!tenant) {
      throw new Error(`Tenant not found: ${slug}`);
    }

    let projectRef: string | null = null;
    let supabaseDeleted = false;

    // Extract project ref from encrypted database URL
    if (tenant.encryptedDatabaseUrl) {
      try {
        const databaseUrl = decrypt(tenant.encryptedDatabaseUrl);
        projectRef = this.extractProjectRef(databaseUrl);
      } catch (error) {
        log.warn(
          { event: 'decrypt_error', slug, error: error instanceof Error ? error.message : String(error) },
          'Could not decrypt database URL to extract project ref'
        );
      }
    }

    // Delete Supabase project (includes database and storage)
    if (projectRef && !options.skipSupabaseDelete) {
      if (!isProvisioningConfigured()) {
        log.warn(
          { event: 'provisioning_not_configured', slug },
          'Cannot delete Supabase project: provisioning credentials not configured'
        );
      } else {
        try {
          log.info({ event: 'supabase_delete_start', slug, projectRef }, 'Deleting Supabase project...');
          await deleteSupabaseProject(projectRef);
          supabaseDeleted = true;
          log.info({ event: 'supabase_deleted', slug, projectRef }, 'Supabase project deleted');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          // Don't fail if project doesn't exist (may have been deleted manually)
          if (errorMsg.includes('404') || errorMsg.includes('not found')) {
            log.info({ event: 'supabase_not_found', slug, projectRef }, 'Supabase project not found (may already be deleted)');
            supabaseDeleted = true; // Consider it deleted
          } else {
            log.error({ event: 'supabase_delete_error', slug, projectRef, error: errorMsg }, 'Failed to delete Supabase project');
            throw new Error(`Failed to delete Supabase project: ${errorMsg}`);
          }
        }
      }
    }

    // Clear connection pool
    await clearTenantConnection(slug);

    // Hard delete tenant record from main database
    await this.mainDb.delete(tenants).where(eq(tenants.slug, slug));

    log.info(
      { event: 'hard_delete_complete', slug, projectRef, supabaseDeleted },
      `Hard delete complete for tenant: ${slug}`
    );

    return {
      tenantDeleted: true,
      supabaseDeleted,
      projectRef,
    };
  }

  // ===========================================================================
  // Pool Management
  // ===========================================================================

  /**
   * Clear a tenant from the connection pool.
   */
  async clearFromPool(slug: string): Promise<void> {
    await clearTenantConnection(slug);
  }

  /**
   * Clear all cached connections.
   */
  async clearPool(): Promise<void> {
    await clearAllTenantConnections();
    log.debug({ event: 'pool_cleared' }, 'Cleared all cached connections');
  }

  /**
   * Get current pool statistics.
   */
  getPoolStats(): { size: number; tenants: string[] } {
    return getTenantPoolStats();
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Mask database host for display (hide sensitive parts).
   */
  private maskHost(databaseUrl: string): string {
    try {
      const url = new URL(databaseUrl);
      const parts = url.hostname.split('.');
      if (parts.length > 2) {
        return `${parts[0]}.***.${parts.slice(-2).join('.')}`;
      }
      return '***';
    } catch {
      return '***';
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let tenantServiceInstance: TenantService | null = null;

/**
 * Get the singleton TenantService instance.
 */
export function getTenantService(): TenantService {
  if (!tenantServiceInstance) {
    tenantServiceInstance = new TenantService();
  }
  return tenantServiceInstance;
}

/**
 * Reset the TenantService singleton (for testing).
 */
export async function resetTenantService(): Promise<void> {
  if (tenantServiceInstance) {
    await tenantServiceInstance.clearPool();
  }
  tenantServiceInstance = null;
}
