/**
 * Document Download API Route
 *
 * GET /api/documents/[id]/download - Get signed URL for original file download
 *
 * Query params:
 * - tenantSlug: Required - Target tenant
 *
 * Returns a signed URL that expires in 1 hour.
 */

import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getTenantService } from '@/lib/services/tenant-service';
import { documents } from '@/db/schema/tenant';
import {
  createRequestContext,
  createLayerLogger,
  Timer,
} from '@/lib/logger';

// =============================================================================
// GET Handler - Download Document
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext({ path: '/api/documents/[id]/download', method: 'GET' });
  const log = createLayerLogger('api', ctx);
  const timer = new Timer();

  const { id: documentId } = await params;
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenantSlug');
  const redirect = searchParams.get('redirect') === 'true';

  log.info({ event: 'request_start', documentId }, 'Document download requested');

  // Validate required params
  if (!tenantSlug) {
    log.warn({ event: 'validation_error' }, 'tenantSlug is required');
    return Response.json(
      {
        error: 'tenantSlug query parameter is required',
        code: 'MISSING_TENANT',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  if (!documentId) {
    log.warn({ event: 'validation_error' }, 'Document ID is required');
    return Response.json(
      {
        error: 'Document ID is required',
        code: 'MISSING_DOCUMENT_ID',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // Get tenant
  timer.mark('tenant');
  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    log.warn({ tenant: tenantSlug }, 'Tenant not found or database unavailable');
    return Response.json(
      {
        error: 'Tenant not found',
        code: 'TENANT_NOT_FOUND',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 404, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
  timer.measure('tenant');

  try {
    // Fetch document record
    timer.mark('db_query');
    const [doc] = await tenantDb
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    timer.measure('db_query');

    if (!doc) {
      log.warn({ documentId }, 'Document not found');
      return Response.json(
        {
          error: 'Document not found',
          code: 'NOT_FOUND',
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        },
        { status: 404, headers: { 'X-Trace-Id': ctx.traceId } }
      );
    }

    // Check if original file is stored
    if (!doc.storageKey) {
      log.warn({ documentId }, 'No original file stored for this document');
      return Response.json(
        {
          error: 'No original file stored for this document',
          code: 'NO_FILE_STORED',
          document: {
            id: doc.id,
            title: doc.title,
            fileName: doc.fileName,
          },
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        },
        { status: 404, headers: { 'X-Trace-Id': ctx.traceId } }
      );
    }

    // Get storage service
    const storageService = await tenantService.getStorageService(tenantSlug);
    if (!storageService) {
      log.error({ tenant: tenantSlug }, 'Storage service unavailable');
      return Response.json(
        {
          error: 'Storage service unavailable',
          code: 'STORAGE_UNAVAILABLE',
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        },
        { status: 503, headers: { 'X-Trace-Id': ctx.traceId } }
      );
    }

    // Generate signed URL
    timer.mark('signed_url');
    const { signedUrl, expiresAt } = await storageService.getSignedUrl(
      doc.storageKey,
      3600 // 1 hour expiration
    );
    timer.measure('signed_url');

    log.info(
      {
        event: 'download_url_generated',
        documentId,
        expiresAt: expiresAt.toISOString(),
        total_ms: timer.elapsed(),
        redirect,
      },
      'Download URL generated successfully'
    );

    // If redirect=true, redirect to the signed URL directly
    if (redirect) {
      return Response.redirect(signedUrl, 302);
    }

    return Response.json(
      {
        document: {
          id: doc.id,
          title: doc.title,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
        },
        download: {
          url: signedUrl,
          expiresAt: expiresAt.toISOString(),
          expiresInSeconds: 3600,
        },
        debug: {
          traceId: ctx.traceId,
          ...timer.getAllDurations(),
          total_ms: timer.elapsed(),
        },
      },
      { status: 200, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  } catch (error) {
    log.error(
      {
        event: 'download_error',
        documentId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Download failed'
    );

    return Response.json(
      {
        error: 'Failed to generate download URL',
        code: 'DOWNLOAD_ERROR',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 500, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
}
