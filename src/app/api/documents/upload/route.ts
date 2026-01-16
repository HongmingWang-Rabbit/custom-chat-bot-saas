/**
 * Document Upload API Route
 *
 * POST /api/documents/upload - Upload files (PDF, TXT, MD, DOCX)
 *
 * Accepts multipart form data with:
 * - file: The file to upload
 * - tenantSlug: Target tenant
 * - title: Optional document title (defaults to filename)
 * - docType: Document type (disclosure, faq, report, filing, other)
 */

import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getTenantService } from '@/lib/services/tenant-service';
import { TenantDatabase } from '@/db';
import {
  documents,
  documentChunks,
  NewDocument,
  NewDocumentChunk,
} from '@/db/schema/tenant';
import { chunkDocument, createEmbeddingService } from '@/lib/rag';
import {
  parseFile,
  validateFile,
  getMimeType,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from '@/lib/parsers';
import {
  createRequestContext,
  createLayerLogger,
  logDbOperation,
  logExternalCall,
  logRagStep,
  logAdminAction,
  Timer,
  truncateText,
} from '@/lib/logger';
import { StorageService, StorageUploadResult } from '@/lib/services/storage-service';
import { getRAGCacheService } from '@/lib/cache';

// =============================================================================
// POST Handler - Upload File
// =============================================================================

export async function POST(request: NextRequest) {
  const ctx = createRequestContext({ path: '/api/documents/upload', method: 'POST' });
  const log = createLayerLogger('api', ctx);
  const timer = new Timer();

  log.info({ event: 'request_start' }, 'Document upload started');

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    log.warn({ event: 'parse_error' }, 'Invalid form data');
    return Response.json(
      {
        error: 'Invalid form data',
        code: 'INVALID_FORM_DATA',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // Extract form fields
  const file = formData.get('file') as File | null;
  const tenantSlug = formData.get('tenantSlug') as string | null;
  const title = formData.get('title') as string | null;
  const docType = (formData.get('docType') as string | null) ?? 'disclosure';
  const url = formData.get('url') as string | null;

  // Validate required fields
  if (!file) {
    log.warn({ event: 'validation_error' }, 'No file provided');
    return Response.json(
      {
        error: 'No file provided',
        code: 'MISSING_FILE',
        supportedTypes: SUPPORTED_EXTENSIONS,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  if (!tenantSlug) {
    log.warn({ event: 'validation_error' }, 'tenantSlug is required');
    return Response.json(
      {
        error: 'tenantSlug is required',
        code: 'MISSING_TENANT',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  log.info(
    {
      event: 'upload_parsed',
      tenant: tenantSlug,
      fileName: file.name,
      fileSize: file.size,
      docType,
    },
    `Processing upload: ${file.name}`
  );

  // Validate file
  const validation = validateFile({ name: file.name, size: file.size });
  if (!validation.valid) {
    log.warn(
      { event: 'validation_error', error: validation.error },
      'Invalid file'
    );
    return Response.json(
      {
        error: validation.error,
        code: 'INVALID_FILE',
        supportedTypes: SUPPORTED_EXTENSIONS,
        maxSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // Get tenant
  timer.mark('tenant');
  const tenantService = getTenantService();
  const tenant = await tenantService.getTenantWithSecrets(tenantSlug);

  if (!tenant) {
    log.warn({ tenant: tenantSlug }, 'Tenant not found');
    return Response.json(
      {
        error: 'Tenant not found',
        code: 'TENANT_NOT_FOUND',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 404, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  const tenantDb = await tenantService.getTenantDb(tenantSlug);
  if (!tenantDb) {
    log.error({ tenant: tenantSlug }, 'Failed to connect to tenant database');
    return Response.json(
      {
        error: 'Failed to connect to tenant database',
        code: 'DB_ERROR',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 500, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // Get storage service (may be null if not configured)
  const storageService = await tenantService.getStorageService(tenantSlug);
  timer.measure('tenant');

  try {
    // Parse file content
    timer.mark('parse');
    const buffer = Buffer.from(await file.arrayBuffer());
    const parseResult = await parseFile(buffer, file.name);
    timer.measure('parse');

    log.debug(
      {
        event: 'file_parsed',
        duration_ms: timer.getDuration('parse'),
        ...parseResult.metadata,
      },
      'File parsed successfully'
    );

    if (!parseResult.content.trim()) {
      log.warn({ event: 'empty_content' }, 'File contains no extractable text');
      return Response.json(
        {
          error: 'File contains no extractable text',
          code: 'EMPTY_CONTENT',
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        },
        { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
      );
    }

    // Generate document ID upfront for storage path
    const docId = crypto.randomUUID();

    // Upload to storage (if available)
    let storageResult: StorageUploadResult | null = null;
    if (storageService) {
      timer.mark('storage_upload');
      try {
        storageResult = await storageService.uploadFile(
          docId,
          file.name,
          buffer,
          file.type || 'application/octet-stream'
        );
        timer.measure('storage_upload');

        log.info(
          {
            event: 'storage_uploaded',
            storageKey: storageResult.storageKey,
            size: storageResult.size,
            duration_ms: timer.getDuration('storage_upload'),
          },
          'File uploaded to storage'
        );
      } catch (storageError) {
        timer.measure('storage_upload');
        log.warn(
          {
            event: 'storage_error',
            error: storageError instanceof Error ? storageError.message : String(storageError),
          },
          'Storage upload failed, continuing without file storage'
        );
        // Continue without storage - not a fatal error
      }
    } else {
      log.debug({ event: 'storage_unavailable' }, 'Storage not configured, skipping file storage');
    }

    // Create document record
    timer.mark('db_insert');
    const docTitle = title || file.name.replace(/\.[^/.]+$/, '');
    const newDoc: NewDocument = {
      id: docId,
      companySlug: tenantSlug,
      title: docTitle,
      content: parseResult.content,
      url: url || undefined,
      docType: docType as 'disclosure' | 'faq' | 'report' | 'filing' | 'other',
      fileName: file.name,
      fileSize: file.size,
      mimeType: getMimeType(file.name),
      storageKey: storageResult?.storageKey ?? null,
      status: 'processing',
    };

    const [doc] = await tenantDb.insert(documents).values(newDoc).returning();
    timer.measure('db_insert');

    logDbOperation(log, 'insert', {
      table: 'documents',
      rows: 1,
      duration_ms: timer.getDuration('db_insert')!,
    });

    // Process document (chunk + embed)
    try {
      await processDocument(
        tenantDb,
        doc.id,
        docTitle,
        parseResult.content,
        tenantSlug,
        tenant.llmApiKey,
        tenant.ragConfig,
        ctx,
        timer
      );

      // Update status to ready
      await tenantDb
        .update(documents)
        .set({ status: 'ready' })
        .where(eq(documents.id, doc.id));

      logAdminAction(createLayerLogger('admin', ctx), 'upload_document', {
        target: docTitle,
      });
    } catch (processError) {
      log.error(
        {
          event: 'processing_error',
          error: processError instanceof Error ? processError.message : String(processError),
        },
        'Document processing failed'
      );

      // Update status to error
      await tenantDb
        .update(documents)
        .set({ status: 'error' })
        .where(eq(documents.id, doc.id));

      return Response.json(
        {
          document: { id: doc.id, title: docTitle, status: 'error' },
          error: 'File uploaded but processing failed',
          code: 'PROCESSING_ERROR',
          debug: {
            traceId: ctx.traceId,
            ...timer.getAllDurations(),
            total_ms: timer.elapsed(),
          },
        },
        { status: 207, headers: { 'X-Trace-Id': ctx.traceId } }
      );
    }

    // Get final document state
    const [updatedDoc] = await tenantDb
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);

    // Invalidate RAG cache for this tenant (new documents may change Q&A results)
    try {
      const cacheService = getRAGCacheService();
      const invalidated = await cacheService.invalidateTenant(tenantSlug);
      if (invalidated > 0) {
        log.info(
          { event: 'cache_invalidated', tenant: tenantSlug, keysDeleted: invalidated },
          `Invalidated ${invalidated} cached RAG responses`
        );
      }
    } catch (cacheError) {
      // Don't fail upload if cache invalidation fails
      log.warn(
        { event: 'cache_invalidation_error', error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
        'Failed to invalidate RAG cache'
      );
    }

    log.info(
      {
        event: 'upload_complete',
        docId: updatedDoc.id,
        title: updatedDoc.title,
        chunkCount: updatedDoc.chunkCount,
        total_ms: timer.elapsed(),
      },
      'Document upload completed successfully'
    );

    return Response.json(
      {
        document: {
          id: updatedDoc.id,
          title: updatedDoc.title,
          fileName: updatedDoc.fileName,
          fileSize: updatedDoc.fileSize,
          status: updatedDoc.status,
          chunkCount: updatedDoc.chunkCount,
          hasOriginalFile: !!updatedDoc.storageKey,
          createdAt: updatedDoc.createdAt,
        },
        metadata: parseResult.metadata,
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
      {
        event: 'upload_error',
        error: error instanceof Error ? error.message : String(error),
      },
      'Upload failed'
    );

    const message =
      error instanceof Error ? error.message : 'Failed to process file';

    return Response.json(
      {
        error: message,
        code: 'UPLOAD_ERROR',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 500, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
}

// =============================================================================
// Document Processing
// =============================================================================

async function processDocument(
  db: TenantDatabase,
  docId: string,
  docTitle: string,
  content: string,
  companySlug: string,
  llmApiKey: string | null,
  ragConfig: { chunkSize?: number; chunkOverlap?: number },
  ctx: ReturnType<typeof createRequestContext>,
  timer: Timer
): Promise<void> {
  const log = createLayerLogger('rag', ctx);

  // 1. Chunk the document
  timer.mark('chunking');
  const chunks = chunkDocument(content, docId, {
    chunkSize: ragConfig.chunkSize ?? 500,
    chunkOverlap: ragConfig.chunkOverlap ?? 50,
  });
  timer.measure('chunking');

  logRagStep(log, 'embedding', {
    duration_ms: timer.getDuration('chunking'),
    chunks: chunks.length,
  });

  if (chunks.length === 0) {
    throw new Error('Document produced no chunks');
  }

  log.debug(
    { event: 'chunking_complete', chunks: chunks.length },
    `Document chunked into ${chunks.length} chunks`
  );

  // 2. Generate embeddings
  timer.mark('embedding');
  const embeddingService = createEmbeddingService(llmApiKey);
  const { embeddings } = await embeddingService.embedBatch(
    chunks.map((c) => c.content)
  );
  timer.measure('embedding');

  logExternalCall(log, 'openai', 'embed_batch', {
    duration_ms: timer.getDuration('embedding'),
    tokens: chunks.reduce((acc, c) => acc + c.content.length / 4, 0), // Rough token estimate
    model: 'text-embedding-3-small',
  });

  // 3. Store chunks with embeddings
  timer.mark('db_chunks');
  const chunkRecords: NewDocumentChunk[] = chunks.map((chunk, index) => ({
    docId,
    companySlug,
    content: chunk.content,
    embedding: embeddings[index],
    chunkIndex: chunk.chunkIndex,
    startChar: chunk.startOffset,
    endChar: chunk.endOffset,
    docTitle,
  }));

  await db.insert(documentChunks).values(chunkRecords);
  timer.measure('db_chunks');

  logDbOperation(log, 'insert', {
    table: 'document_chunks',
    rows: chunkRecords.length,
    duration_ms: timer.getDuration('db_chunks')!,
  });

  // 4. Update document chunk count
  await db
    .update(documents)
    .set({ chunkCount: chunks.length })
    .where(eq(documents.id, docId));

  log.info(
    {
      event: 'processing_complete',
      docId,
      chunks: chunks.length,
    },
    'Document processing completed'
  );
}

// =============================================================================
// GET Handler - Upload Info
// =============================================================================

export async function GET() {
  return Response.json({
    supportedTypes: SUPPORTED_EXTENSIONS,
    maxFileSize: MAX_FILE_SIZE,
    maxFileSizeMB: `${MAX_FILE_SIZE / 1024 / 1024}MB`,
    fields: {
      file: 'required - The file to upload',
      tenantSlug: 'required - Target tenant slug',
      title: 'optional - Document title (defaults to filename)',
      docType: 'optional - disclosure | faq | report | filing | other',
      url: 'optional - Source URL for reference',
    },
  });
}
