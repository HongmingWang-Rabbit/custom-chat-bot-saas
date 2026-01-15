/**
 * Tenant Service
 *
 * Manages tenant data and database connections using Drizzle ORM.
 * Features:
 * - Encrypts/decrypts sensitive credentials
 * - Caches tenant database connections
 * - Type-safe queries with Drizzle
 */

import { eq, and } from 'drizzle-orm';
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
  isProvisioningConfigured,
  SupabaseCredentials,
} from '@/lib/supabase/provisioning';
import { runTenantMigrations, MigrationResult } from '@/lib/supabase/tenant-migrations';
import { logger } from '@/lib/logger';

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
   * List all active tenants (without secrets).
   */
  async listTenants(): Promise<Tenant[]> {
    return this.mainDb
      .select()
      .from(tenants)
      .where(eq(tenants.status, 'active'))
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
   * This method:
   * 1. Validates that Supabase Management API credentials are configured
   * 2. Creates a new Supabase project for the tenant
   * 3. Waits for the project to be ready
   * 4. Runs database migrations (pgvector, tables, indexes)
   * 5. Creates the tenant record with encrypted credentials
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
      // Step 2: Provision the Supabase project
      log.debug({ event: 'supabase_provisioning', slug: params.slug }, 'Provisioning Supabase project');
      const supabaseCredentials = await provisionSupabaseProject(
        params.slug,
        params.region
      );

      // Step 3: Run tenant database migrations
      log.debug({ event: 'migrations_start', slug: params.slug }, 'Running database migrations');
      const migrations = await runTenantMigrations(supabaseCredentials.databaseUrl);

      if (!migrations.success) {
        log.error(
          { event: 'migrations_failed', slug: params.slug, errors: migrations.errors },
          'Migrations failed'
        );
        // Continue anyway - tenant can be created, migrations can be retried
      }

      // Step 4: Create the tenant record with encrypted credentials
      log.debug({ event: 'creating_record', slug: params.slug }, 'Creating tenant record');
      const tenant = await this.createTenant({
        slug: params.slug,
        name: params.name,
        databaseUrl: supabaseCredentials.databaseUrl,
        serviceKey: supabaseCredentials.serviceKey,
        anonKey: supabaseCredentials.anonKey,
        llmApiKey: params.llmApiKey,
        branding: params.branding,
        ragConfig: params.ragConfig,
      });

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
    // Get existing tenant to merge partial updates
    const existing = await this.getTenant(slug);
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
