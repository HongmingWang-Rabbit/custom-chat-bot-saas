/**
 * Tenant Detail API Route
 *
 * GET /api/tenants/[slug] - Get tenant details
 * PATCH /api/tenants/[slug] - Update tenant settings
 * DELETE /api/tenants/[slug] - Delete tenant (soft delete)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantService } from '@/lib/services/tenant-service';
import { TenantBranding, RAGConfig, DEFAULT_BRANDING, DEFAULT_RAG_CONFIG, TenantStatus } from '@/db/schema/main';
import { logger } from '@/lib/logger';

// Create a child logger for tenant detail API
const log = logger.child({ layer: 'admin', service: 'tenants' });

// =============================================================================
// Request Validation
// =============================================================================

const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  branding: z
    .object({
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      logoUrl: z.string().url().optional().nullable(),
      faviconUrl: z.string().url().optional().nullable(),
      customCss: z.string().optional(),
    })
    .optional(),
  llmProvider: z.enum(['openai', 'anthropic', 'azure']).optional(),
  ragConfig: z
    .object({
      topK: z.number().min(1).max(20).optional(),
      confidenceThreshold: z.number().min(0).max(1).optional(),
      chunkSize: z.number().min(100).max(2000).optional(),
      chunkOverlap: z.number().min(0).max(500).optional(),
    })
    .optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
});

const updateCredentialsSchema = z.object({
  databaseUrl: z.string().url().optional(),
  serviceKey: z.string().min(1).optional(),
  anonKey: z.string().min(1).optional(),
  llmApiKey: z.string().optional(),
});

type UpdateTenantRequest = z.infer<typeof updateTenantSchema>;

// =============================================================================
// GET Handler - Get Tenant Details
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const tenantService = getTenantService();
    const tenant = await tenantService.getTenant(slug);

    if (!tenant) {
      return Response.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Return safe fields
    return Response.json({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        databaseHost: tenant.databaseHost,
        databaseRegion: tenant.databaseRegion,
        branding: tenant.branding ?? DEFAULT_BRANDING,
        llmProvider: tenant.llmProvider,
        ragConfig: tenant.ragConfig ?? DEFAULT_RAG_CONFIG,
        status: tenant.status,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
    });
  } catch (error) {
    log.error({ event: 'get_error', slug, error: error instanceof Error ? error.message : String(error) }, 'Failed to get tenant');
    return Response.json(
      { error: 'Failed to get tenant', code: 'GET_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH Handler - Update Tenant
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Parse request body
  let body: UpdateTenantRequest;
  try {
    const json = await request.json();
    body = updateTenantSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Invalid request body', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const tenantService = getTenantService();

  // Check tenant exists
  const existing = await tenantService.getTenant(slug);
  if (!existing) {
    return Response.json(
      { error: 'Tenant not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    const updated = await tenantService.updateTenant(slug, {
      name: body.name,
      branding: body.branding as Partial<TenantBranding>,
      llmProvider: body.llmProvider,
      ragConfig: body.ragConfig as Partial<RAGConfig>,
      status: body.status as TenantStatus,
    });

    if (!updated) {
      return Response.json(
        { error: 'Failed to update tenant', code: 'UPDATE_ERROR' },
        { status: 500 }
      );
    }

    return Response.json({
      tenant: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
        databaseHost: updated.databaseHost,
        branding: updated.branding,
        llmProvider: updated.llmProvider,
        ragConfig: updated.ragConfig,
        status: updated.status,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    log.error({ event: 'update_error', slug, error: error instanceof Error ? error.message : String(error) }, 'Failed to update tenant');
    return Response.json(
      { error: 'Failed to update tenant', code: 'UPDATE_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Soft Delete Tenant
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const tenantService = getTenantService();

  // Check tenant exists
  const existing = await tenantService.getTenant(slug);
  if (!existing) {
    return Response.json(
      { error: 'Tenant not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    await tenantService.deleteTenant(slug);
    log.info({ event: 'tenant_deleted', slug }, 'Tenant deleted');
    return Response.json({ success: true, message: 'Tenant deleted' });
  } catch (error) {
    log.error({ event: 'delete_error', slug, error: error instanceof Error ? error.message : String(error) }, 'Failed to delete tenant');
    return Response.json(
      { error: 'Failed to delete tenant', code: 'DELETE_ERROR' },
      { status: 500 }
    );
  }
}
