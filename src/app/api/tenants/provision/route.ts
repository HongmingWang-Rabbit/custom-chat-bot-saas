/**
 * Tenant Auto-Provisioning API Route
 *
 * POST /api/tenants/provision - Automatically provision a new tenant
 *
 * This endpoint handles tenant setup ASYNCHRONOUSLY:
 * 1. Creates a new Supabase project + storage bucket (sync)
 * 2. Creates tenant record with status "provisioning" (sync)
 * 3. Returns immediately to user
 * 4. Runs database migrations in background (async)
 * 5. Updates tenant status to "active" when ready
 *
 * Required environment variables:
 * - SUPABASE_ACCESS_TOKEN - Management API token
 * - SUPABASE_ORG_ID - Organization ID for new projects
 * - MASTER_KEY - For encrypting tenant credentials
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantService } from '@/lib/services/tenant-service';
import {
  provisionSupabaseProject,
  isProvisioningConfigured,
} from '@/lib/supabase/provisioning';
import { runTenantMigrations } from '@/lib/supabase/tenant-migrations';
import { TenantBranding, RAGConfig } from '@/db/schema/main';
import {
  createRequestContext,
  createLayerLogger,
  logAdminAction,
  Timer,
  logger,
} from '@/lib/logger';

// =============================================================================
// Request Validation
// =============================================================================

const provisionTenantSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(255),
  region: z.string().optional(), // e.g., 'us-east-1', 'eu-west-1'
  llmApiKey: z.string().optional(), // Optional: use tenant's own OpenAI key
  branding: z
    .object({
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      logoUrl: z.string().url().optional(),
      faviconUrl: z.string().url().optional(),
      customCss: z.string().optional(),
    })
    .optional(),
  ragConfig: z
    .object({
      topK: z.number().min(1).max(20).optional(),
      confidenceThreshold: z.number().min(0).max(1).optional(),
      chunkSize: z.number().min(100).max(2000).optional(),
      chunkOverlap: z.number().min(0).max(500).optional(),
    })
    .optional(),
});

type ProvisionTenantRequest = z.infer<typeof provisionTenantSchema>;

// =============================================================================
// GET Handler - Check Provisioning Status
// =============================================================================

export async function GET() {
  const isConfigured = isProvisioningConfigured();

  return Response.json({
    provisioning: {
      available: isConfigured,
      message: isConfigured
        ? 'Auto-provisioning is available'
        : 'Auto-provisioning is not configured. Set SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_ID.',
    },
    requiredFields: {
      slug: 'required - Unique tenant identifier (lowercase, alphanumeric, hyphens)',
      name: 'required - Display name for the tenant',
      region: 'optional - Supabase region (default: us-east-1)',
      llmApiKey: 'optional - Tenant-specific OpenAI API key',
      branding: 'optional - UI customization options',
      ragConfig: 'optional - RAG pipeline configuration',
    },
    features: [
      'Automatic Supabase project creation',
      'Storage bucket with CDN (Cloudflare)',
      'Database schema migrations',
      'Encrypted credential storage',
    ],
  });
}

// =============================================================================
// POST Handler - Provision New Tenant
// =============================================================================

export async function POST(request: NextRequest) {
  const ctx = createRequestContext({ path: '/api/tenants/provision', method: 'POST' });
  const log = createLayerLogger('admin', ctx);
  const timer = new Timer();

  log.info({ event: 'request_start' }, 'Tenant provisioning started');

  // Check if provisioning is configured
  if (!isProvisioningConfigured()) {
    log.error({ event: 'config_error' }, 'Provisioning not configured');
    return Response.json(
      {
        error: 'Auto-provisioning is not configured',
        code: 'PROVISIONING_NOT_CONFIGURED',
        details: 'Set SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_ID environment variables',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 503, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // Parse and validate request body
  let body: ProvisionTenantRequest;
  try {
    const json = await request.json();
    body = provisionTenantSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      log.warn({ event: 'validation_error', errors: error.errors }, 'Validation failed');
      return Response.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.errors,
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        },
        { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
      );
    }
    log.warn({ event: 'parse_error' }, 'Invalid request body');
    return Response.json(
      {
        error: 'Invalid request body',
        code: 'INVALID_REQUEST',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  log.info(
    { event: 'provisioning_start', slug: body.slug, name: body.name, region: body.region },
    `Provisioning tenant: ${body.slug}`
  );

  const tenantService = getTenantService();

  // Check if slug is available
  timer.mark('slug_check');
  const isAvailable = await tenantService.isSlugAvailable(body.slug);
  timer.measure('slug_check');

  if (!isAvailable) {
    log.warn({ event: 'slug_taken', slug: body.slug }, 'Slug is already taken');
    return Response.json(
      {
        error: 'Slug is already taken',
        code: 'SLUG_TAKEN',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 409, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  try {
    // Step 1: Create provisional tenant record (stores password for recovery)
    timer.mark('tenant_create');
    log.info({ event: 'tenant_creating' }, 'Creating provisional tenant record...');

    const { dbPassword, isRecovery, projectRef: existingProjectRef } =
      await tenantService.getOrCreateProvisioningState(
        body.slug,
        body.name,
        () => {
          // Import and use generateSecurePassword
          const crypto = require('crypto');
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
          const randomBytes = crypto.randomBytes(32);
          let password = '';
          for (let i = 0; i < 32; i++) {
            password += chars[randomBytes[i] % chars.length];
          }
          return password;
        }
      );
    timer.measure('tenant_create');

    // Get the created tenant record
    const tenant = await tenantService.getTenantAnyStatus(body.slug);
    if (!tenant) {
      throw new Error('Failed to create provisional tenant record');
    }

    logAdminAction(log, 'provision_tenant', { target: body.slug });

    log.info(
      {
        event: 'tenant_created',
        tenantId: tenant.id,
        slug: tenant.slug,
        isRecovery,
        total_ms: timer.elapsed(),
      },
      `Provisional tenant created, starting background provisioning: ${tenant.slug}`
    );

    // Step 2: Run entire provisioning in background (don't await)
    // This includes: create Supabase project, wait for ready, get keys, create bucket, run migrations
    runProvisioningInBackground(
      tenant.slug,
      body.region,
      body.llmApiKey,
      body.branding as Partial<TenantBranding>,
      body.ragConfig as Partial<RAGConfig>,
      dbPassword,
      isRecovery ? existingProjectRef : null,
      tenantService,
      ctx.traceId
    );

    // Return immediately with provisioning status
    return Response.json(
      {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: 'provisioning',
          createdAt: tenant.createdAt,
        },
        features: {
          database: true,
          storage: true,
          cdn: true, // Supabase Storage includes Cloudflare CDN
        },
        message: 'Tenant created. Supabase project provisioning in background (may take 2-5 minutes). Poll GET /api/tenants/{slug} to check status.',
        debug: {
          traceId: ctx.traceId,
          isRecovery,
          ...timer.getAllDurations(),
          total_ms: timer.elapsed(),
        },
      },
      { status: 202, headers: { 'X-Trace-Id': ctx.traceId } } // 202 Accepted - processing continues
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error(
      {
        event: 'provisioning_error',
        slug: body.slug,
        error: errorMessage,
        total_ms: timer.elapsed(),
      },
      'Tenant provisioning failed'
    );

    // Provide specific error messages for common failures
    let code = 'PROVISIONING_ERROR';
    let status = 500;

    if (errorMessage.includes('quota exceeded')) {
      code = 'QUOTA_EXCEEDED';
      status = 402;
    } else if (errorMessage.includes('authentication failed')) {
      code = 'AUTH_ERROR';
      status = 401;
    } else if (errorMessage.includes('rate limit')) {
      code = 'RATE_LIMITED';
      status = 429;
    }

    return Response.json(
      {
        error: 'Failed to provision tenant',
        code,
        details: errorMessage,
        debug: {
          traceId: ctx.traceId,
          ...timer.getAllDurations(),
          total_ms: timer.elapsed(),
        },
      },
      { status, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
}

// =============================================================================
// Background Provisioning Runner
// =============================================================================

/**
 * Run entire Supabase provisioning in the background.
 * This includes: create project, wait for ready, get keys, create bucket, run migrations.
 * Updates tenant status to 'active' on success or 'error' on failure.
 */
async function runProvisioningInBackground(
  tenantSlug: string,
  region: string | undefined,
  llmApiKey: string | undefined,
  branding: Partial<TenantBranding> | undefined,
  ragConfig: Partial<RAGConfig> | undefined,
  dbPassword: string,
  existingProjectRef: string | null,
  tenantService: ReturnType<typeof getTenantService>,
  traceId: string
): Promise<void> {
  const log = logger.child({ layer: 'background', traceId, tenant: tenantSlug });

  log.info({ event: 'background_provisioning_start', isRecovery: !!existingProjectRef }, `Starting background provisioning for ${tenantSlug}`);

  try {
    // Step 1: Provision Supabase project (this polls for readiness internally)
    log.info({ event: 'supabase_provisioning' }, 'Creating Supabase project...');
    const credentials = await provisionSupabaseProject(tenantSlug, {
      region,
      dbPassword,
      existingProjectRef: existingProjectRef ?? undefined,
      onProjectCreated: async (projectRef) => {
        // Save project ref immediately for recovery
        await tenantService.updateProvisioningProjectRef(tenantSlug, projectRef);
      },
    });

    log.info(
      {
        event: 'supabase_provisioned',
        projectRef: credentials.projectRef,
        storageBucket: credentials.storageBucketName,
      },
      `Supabase project created: ${credentials.projectRef}`
    );

    // Step 2: Wait for database to be ready for migrations
    log.info({ event: 'waiting_for_db' }, 'Waiting for database to be ready...');
    const maxRetries = 60;
    const retryDelay = 5000;
    let dbReady = false;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));

      try {
        const postgres = (await import('postgres')).default;
        const testSql = postgres(credentials.databaseUrl, { max: 1, connect_timeout: 10 });
        await testSql`SELECT 1`;
        await testSql.end();
        dbReady = true;
        log.info({ event: 'db_ready', attempt: i + 1 }, 'Database connection successful');
        break;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        log.debug(
          { event: 'db_not_ready', attempt: i + 1, maxRetries },
          `Database not ready (${i + 1}/${maxRetries}): ${errorMsg}`
        );
      }
    }

    if (!dbReady) {
      throw new Error('Database did not become ready within 5 minutes');
    }

    // Step 3: Run migrations
    log.info({ event: 'migrations_running' }, 'Running database migrations...');
    const migrationResult = await runTenantMigrations(credentials.databaseUrl);

    if (!migrationResult.success) {
      throw new Error(`Migrations failed: ${migrationResult.errors.join(', ')}`);
    }

    log.info(
      { event: 'migrations_complete', migrationsRun: migrationResult.migrationsRun },
      'Database migrations completed successfully'
    );

    // Step 4: Complete provisioning with credentials
    log.info({ event: 'completing_provisioning' }, 'Completing provisioning...');
    await tenantService.completeProvisioning(
      tenantSlug,
      {
        databaseUrl: credentials.databaseUrl,
        serviceKey: credentials.serviceKey,
        anonKey: credentials.anonKey,
        llmApiKey,
      },
      branding,
      ragConfig
    );

    log.info({ event: 'background_provisioning_complete' }, `Tenant ${tenantSlug} is now active`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error({ event: 'background_provisioning_failed', error: errorMsg }, `Background provisioning failed for ${tenantSlug}`);

    // Update tenant status to error
    try {
      await tenantService.failProvisioning(tenantSlug, errorMsg);
    } catch (updateError) {
      log.error({ event: 'status_update_failed' }, 'Failed to update tenant status to error');
    }
  }
}
