/**
 * Tenant Auto-Provisioning API Route
 *
 * POST /api/tenants/provision - Create a new tenant for provisioning
 *
 * This endpoint creates a tenant record and returns immediately.
 * The frontend then polls POST /api/tenants/{slug}/continue to progress
 * through the provisioning steps:
 * 1. Create Supabase project (slow, ~1-3 minutes)
 * 2. Run database migrations
 * 3. Mark tenant as active
 *
 * Required environment variables:
 * - SUPABASE_ACCESS_TOKEN - Management API token
 * - SUPABASE_ORG_ID - Organization ID for new projects
 * - MASTER_KEY - For encrypting tenant credentials
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getTenantService } from '@/lib/services/tenant-service';
import { isProvisioningConfigured } from '@/lib/supabase/provisioning';
import {
  createRequestContext,
  createLayerLogger,
  logAdminAction,
  Timer,
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
      topK: z.number().min(1).max(50).optional(),
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
          // Generate secure password
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
      `Provisional tenant created: ${tenant.slug}`
    );

    // Return immediately - frontend will poll /api/tenants/{slug}/continue to progress
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
        nextStep: 'Call POST /api/tenants/{slug}/continue to progress provisioning',
        message: 'Tenant record created. Call the continue endpoint to provision Supabase project.',
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

