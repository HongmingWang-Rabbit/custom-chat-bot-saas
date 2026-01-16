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
    // Step 1: Provision Supabase project (includes storage bucket with CDN)
    timer.mark('supabase_provision');
    log.info({ event: 'supabase_provisioning' }, 'Creating Supabase project...');

    const credentials = await provisionSupabaseProject(body.slug, { region: body.region });
    timer.measure('supabase_provision');

    log.info(
      {
        event: 'supabase_provisioned',
        projectRef: credentials.projectRef,
        storageBucket: credentials.storageBucketName,
        duration_ms: timer.getDuration('supabase_provision'),
      },
      `Supabase project created: ${credentials.projectRef}`
    );

    // Step 2: Create tenant record with "provisioning" status
    timer.mark('tenant_create');
    log.info({ event: 'tenant_creating' }, 'Creating tenant record...');

    const tenant = await tenantService.createTenant({
      slug: body.slug,
      name: body.name,
      databaseUrl: credentials.databaseUrl,
      serviceKey: credentials.serviceKey,
      anonKey: credentials.anonKey,
      llmApiKey: body.llmApiKey,
      branding: body.branding as Partial<TenantBranding>,
      ragConfig: body.ragConfig as Partial<RAGConfig>,
      status: 'provisioning', // Will be updated to 'active' after migrations
      supabaseProjectRef: credentials.projectRef,
    });
    timer.measure('tenant_create');

    logAdminAction(log, 'provision_tenant', {
      target: `${body.slug} (${credentials.projectRef})`,
    });

    log.info(
      {
        event: 'tenant_created',
        tenantId: tenant.id,
        slug: tenant.slug,
        projectRef: credentials.projectRef,
        total_ms: timer.elapsed(),
      },
      `Tenant created, starting background migrations: ${tenant.slug}`
    );

    // Step 3: Run migrations in background (don't await)
    // Use pooler URL - direct DB DNS may not propagate for a while
    runMigrationsInBackground(
      tenant.slug,
      credentials.databaseUrl,
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
        supabase: {
          projectRef: credentials.projectRef,
          apiUrl: credentials.apiUrl,
          storageBucket: credentials.storageBucketName,
          region: body.region || 'us-east-1',
        },
        features: {
          database: true,
          storage: true,
          cdn: true, // Supabase Storage includes Cloudflare CDN
        },
        message: 'Tenant created. Database migrations running in background. Poll GET /api/tenants/{slug} to check status.',
        debug: {
          traceId: ctx.traceId,
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
// Background Migration Runner
// =============================================================================

/**
 * Run database migrations in the background.
 * Updates tenant status to 'active' on success or 'error' on failure.
 */
async function runMigrationsInBackground(
  tenantSlug: string,
  databaseUrl: string,
  tenantService: ReturnType<typeof getTenantService>,
  traceId: string
): Promise<void> {
  const log = logger.child({ layer: 'background', traceId, tenant: tenantSlug });

  log.info({ event: 'background_migrations_start' }, `Starting background migrations for ${tenantSlug}`);

  // Retry configuration for database readiness
  // Supabase projects can take 3-5 minutes for DNS/database to be fully ready
  const maxRetries = 60; // Up to 5 minutes total
  const retryDelay = 5000; // 5 seconds between retries

  try {
    // Wait for database to be ready (pooler user setup takes time)
    let dbReady = false;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));

      try {
        const postgres = (await import('postgres')).default;
        const testSql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
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

    // Run migrations
    log.info({ event: 'migrations_running' }, 'Running database migrations...');
    const migrationResult = await runTenantMigrations(databaseUrl);

    if (!migrationResult.success) {
      throw new Error(`Migrations failed: ${migrationResult.errors.join(', ')}`);
    }

    log.info(
      { event: 'migrations_complete', migrationsRun: migrationResult.migrationsRun },
      'Database migrations completed successfully'
    );

    // Update tenant status to active
    await tenantService.updateTenantStatus(tenantSlug, 'active');

    log.info({ event: 'background_migrations_complete' }, `Tenant ${tenantSlug} is now active`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error({ event: 'background_migrations_failed', error: errorMsg }, `Background migrations failed for ${tenantSlug}`);

    // Update tenant status to error
    try {
      await tenantService.updateTenantStatus(tenantSlug, 'error');
    } catch (updateError) {
      log.error({ event: 'status_update_failed' }, 'Failed to update tenant status to error');
    }
  }
}
