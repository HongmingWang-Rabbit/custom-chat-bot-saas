/**
 * Tenants API Route
 *
 * GET /api/tenants - List all tenants
 * POST /api/tenants - Create a new tenant
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantService } from '@/lib/services/tenant-service';
import { TenantBranding, RAGConfig, DEFAULT_BRANDING, DEFAULT_RAG_CONFIG } from '@/db/schema/main';
import {
  createRequestContext,
  createLayerLogger,
  logAdminAction,
  logDbOperation,
  Timer,
} from '@/lib/logger';

// =============================================================================
// Request Validation
// =============================================================================

const createTenantSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(255),
  databaseUrl: z.string().url(),
  serviceKey: z.string().min(1),
  anonKey: z.string().min(1),
  llmApiKey: z.string().optional(),
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

type CreateTenantRequest = z.infer<typeof createTenantSchema>;

// =============================================================================
// GET Handler - List Tenants
// =============================================================================

export async function GET() {
  const ctx = createRequestContext({ path: '/api/tenants', method: 'GET' });
  const log = createLayerLogger('admin', ctx);
  const timer = new Timer();

  log.info({ event: 'request_start' }, 'Listing tenants');

  try {
    timer.mark('db');
    const tenantService = getTenantService();
    const tenants = await tenantService.listTenants();
    timer.measure('db');

    logDbOperation(log, 'select', {
      table: 'tenants',
      rows: tenants.length,
      duration_ms: timer.getDuration('db')!,
    });

    // Return only safe fields (no encrypted data)
    const safeTenants = tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      databaseHost: t.databaseHost,
      databaseRegion: t.databaseRegion,
      branding: t.branding ?? DEFAULT_BRANDING,
      llmProvider: t.llmProvider,
      ragConfig: t.ragConfig ?? DEFAULT_RAG_CONFIG,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    log.info(
      { event: 'request_complete', count: tenants.length, total_ms: timer.elapsed() },
      'Tenants listed successfully'
    );

    return Response.json(
      {
        tenants: safeTenants,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { headers: { 'X-Trace-Id': ctx.traceId } }
    );
  } catch (error) {
    log.error(
      { event: 'list_error', error: error instanceof Error ? error.message : String(error) },
      'Failed to list tenants'
    );
    return Response.json(
      {
        error: 'Failed to list tenants',
        code: 'LIST_ERROR',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 500, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
}

// =============================================================================
// POST Handler - Create Tenant
// =============================================================================

export async function POST(request: NextRequest) {
  const ctx = createRequestContext({ path: '/api/tenants', method: 'POST' });
  const log = createLayerLogger('admin', ctx);
  const timer = new Timer();

  log.info({ event: 'request_start' }, 'Creating tenant');

  // Parse request body
  let body: CreateTenantRequest;
  try {
    const json = await request.json();
    body = createTenantSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      log.warn(
        { event: 'validation_error', errors: error.errors },
        'Validation failed'
      );
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

  log.info({ event: 'tenant_creating', slug: body.slug, name: body.name }, 'Creating tenant');

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
    timer.mark('db');

    // Create tenant with encrypted credentials
    const tenant = await tenantService.createTenant({
      slug: body.slug,
      name: body.name,
      databaseUrl: body.databaseUrl,
      serviceKey: body.serviceKey,
      anonKey: body.anonKey,
      llmApiKey: body.llmApiKey,
      branding: body.branding as Partial<TenantBranding>,
      ragConfig: body.ragConfig as Partial<RAGConfig>,
    });

    timer.measure('db');

    logDbOperation(log, 'insert', {
      table: 'tenants',
      rows: 1,
      duration_ms: timer.getDuration('db')!,
    });

    logAdminAction(log, 'create_tenant', { target: body.slug });

    log.info(
      {
        event: 'tenant_created',
        tenantId: tenant.id,
        slug: tenant.slug,
        total_ms: timer.elapsed(),
      },
      `Tenant created: ${tenant.slug}`
    );

    // Return safe response (no secrets)
    return Response.json(
      {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          databaseHost: tenant.databaseHost,
          branding: tenant.branding,
          ragConfig: tenant.ragConfig,
          status: tenant.status,
          createdAt: tenant.createdAt,
        },
        debug: {
          traceId: ctx.traceId,
          ...timer.getAllDurations(),
          total_ms: timer.elapsed(),
        },
      },
      { status: 201, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  } catch (error) {
    log.error(
      { event: 'create_error', error: error instanceof Error ? error.message : String(error) },
      'Failed to create tenant'
    );
    return Response.json(
      {
        error: 'Failed to create tenant',
        code: 'CREATE_ERROR',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 500, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
}
