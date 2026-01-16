/**
 * Document Detail API Route
 *
 * GET /api/documents/[id] - Get document details
 * PATCH /api/documents/[id] - Update document metadata
 * DELETE /api/documents/[id] - Delete document and its chunks
 *
 * Query params:
 * - tenantSlug: Required - Target tenant
 */

import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getTenantService } from '@/lib/services/tenant-service';
import { documents, documentChunks } from '@/db/schema/tenant';
import {
  createRequestContext,
  createLayerLogger,
  logDbOperation,
  logAdminAction,
  Timer,
} from '@/lib/logger';

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  docType: z.enum(['disclosure', 'faq', 'report', 'filing', 'other']).optional(),
});

// =============================================================================
// GET Handler - Get Document Details
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext({ path: '/api/documents/[id]', method: 'GET' });
  const log = createLayerLogger('api', ctx);

  const { id: documentId } = await params;
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenantSlug');

  if (!tenantSlug) {
    return Response.json(
      { error: 'tenantSlug query parameter is required', code: 'MISSING_TENANT' },
      { status: 400 }
    );
  }

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    const [doc] = await tenantDb
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) {
      return Response.json(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return Response.json({
      document: {
        id: doc.id,
        title: doc.title,
        url: doc.url,
        docType: doc.docType,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        status: doc.status,
        chunkCount: doc.chunkCount,
        hasOriginalFile: !!doc.storageKey,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    log.error({ event: 'get_error', documentId, error: error instanceof Error ? error.message : String(error) }, 'Failed to get document');
    return Response.json(
      { error: 'Failed to get document', code: 'GET_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH Handler - Update Document Metadata
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext({ path: '/api/documents/[id]', method: 'PATCH' });
  const log = createLayerLogger('api', ctx);
  const timer = new Timer();

  const { id: documentId } = await params;
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenantSlug');

  if (!tenantSlug) {
    return Response.json(
      { error: 'tenantSlug query parameter is required', code: 'MISSING_TENANT' },
      { status: 400 }
    );
  }

  // Parse and validate request body
  let body: z.infer<typeof updateDocumentSchema>;
  try {
    const json = await request.json();
    body = updateDocumentSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.errors },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Invalid request body', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    // Check document exists
    const [existingDoc] = await tenantDb
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!existingDoc) {
      return Response.json(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Update document
    timer.mark('update_doc');
    const [updatedDoc] = await tenantDb
      .update(documents)
      .set({
        ...(body.title && { title: body.title }),
        ...(body.docType && { docType: body.docType }),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
      .returning();
    timer.measure('update_doc');

    logDbOperation(log, 'update', {
      table: 'documents',
      rows: 1,
      duration_ms: timer.getDuration('update_doc')!,
    });

    logAdminAction(log, 'update_document', { target: updatedDoc.title });

    log.info(
      { event: 'document_updated', documentId, title: updatedDoc.title },
      'Document updated successfully'
    );

    return Response.json({
      document: {
        id: updatedDoc.id,
        title: updatedDoc.title,
        docType: updatedDoc.docType,
        status: updatedDoc.status,
        updatedAt: updatedDoc.updatedAt,
      },
    });
  } catch (error) {
    log.error(
      { event: 'update_error', documentId, error: error instanceof Error ? error.message : String(error) },
      'Failed to update document'
    );
    return Response.json(
      { error: 'Failed to update document', code: 'UPDATE_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Delete Document
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext({ path: '/api/documents/[id]', method: 'DELETE' });
  const log = createLayerLogger('api', ctx);
  const timer = new Timer();

  const { id: documentId } = await params;
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenantSlug');

  log.info({ event: 'request_start', documentId }, 'Document delete requested');

  if (!tenantSlug) {
    return Response.json(
      { error: 'tenantSlug query parameter is required', code: 'MISSING_TENANT' },
      { status: 400 }
    );
  }

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    // Check document exists and get storage key
    timer.mark('db_query');
    const [doc] = await tenantDb
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    timer.measure('db_query');

    if (!doc) {
      return Response.json(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Delete from storage if file exists
    if (doc.storageKey) {
      try {
        const storageService = await tenantService.getStorageService(tenantSlug);
        if (storageService) {
          timer.mark('storage_delete');
          await storageService.deleteFile(doc.storageKey);
          timer.measure('storage_delete');
          log.info({ event: 'storage_deleted', storageKey: doc.storageKey }, 'File deleted from storage');
        }
      } catch (storageError) {
        // Log but don't fail - storage deletion is not critical
        log.warn(
          { event: 'storage_delete_error', error: storageError instanceof Error ? storageError.message : String(storageError) },
          'Failed to delete file from storage'
        );
      }
    }

    // Delete document chunks first (foreign key)
    timer.mark('delete_chunks');
    const deletedChunks = await tenantDb
      .delete(documentChunks)
      .where(eq(documentChunks.docId, documentId))
      .returning();
    timer.measure('delete_chunks');

    logDbOperation(log, 'delete', {
      table: 'document_chunks',
      rows: deletedChunks.length,
      duration_ms: timer.getDuration('delete_chunks')!,
    });

    // Delete document
    timer.mark('delete_doc');
    await tenantDb
      .delete(documents)
      .where(eq(documents.id, documentId));
    timer.measure('delete_doc');

    logDbOperation(log, 'delete', {
      table: 'documents',
      rows: 1,
      duration_ms: timer.getDuration('delete_doc')!,
    });

    logAdminAction(log, 'delete_document', { target: doc.title });

    log.info(
      {
        event: 'document_deleted',
        documentId,
        title: doc.title,
        chunksDeleted: deletedChunks.length,
        total_ms: timer.elapsed(),
      },
      'Document deleted successfully'
    );

    return Response.json({
      success: true,
      deleted: {
        documentId,
        title: doc.title,
        chunksDeleted: deletedChunks.length,
        fileDeleted: !!doc.storageKey,
      },
    });
  } catch (error) {
    log.error(
      { event: 'delete_error', documentId, error: error instanceof Error ? error.message : String(error) },
      'Failed to delete document'
    );
    return Response.json(
      { error: 'Failed to delete document', code: 'DELETE_ERROR' },
      { status: 500 }
    );
  }
}
