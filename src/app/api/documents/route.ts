/**
 * Documents API Route
 *
 * GET /api/documents - List documents for a tenant
 * POST /api/documents - Upload and process a new document
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getTenantService } from '@/lib/services/tenant-service';
import { TenantDatabase } from '@/db';
import { documents, documentChunks, NewDocument, NewDocumentChunk, DocumentStatus } from '@/db/schema/tenant';
import { chunkDocument, createEmbeddingService } from '@/lib/rag';
import { logger } from '@/lib/logger';

// Create a child logger for documents API
const log = logger.child({ layer: 'api', service: 'documents' });

// =============================================================================
// Request Validation
// =============================================================================

const listDocumentsSchema = z.object({
  tenantSlug: z.string().min(1),
  status: z.enum(['pending', 'processing', 'ready', 'error']).optional(),
});

const createDocumentSchema = z.object({
  tenantSlug: z.string().min(1),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  url: z.string().url().optional(),
  docType: z.enum(['disclosure', 'faq', 'report', 'filing', 'other']).optional(),
  fileName: z.string().optional(),
  processImmediately: z.boolean().optional().default(true),
});

type CreateDocumentRequest = z.infer<typeof createDocumentSchema>;

// =============================================================================
// GET Handler - List Documents
// =============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenantSlug');
  const status = searchParams.get('status') as DocumentStatus | null;

  if (!tenantSlug) {
    return Response.json(
      { error: 'tenantSlug is required', code: 'MISSING_TENANT' },
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
    let query = tenantDb.select().from(documents);

    if (status) {
      query = query.where(eq(documents.status, status)) as typeof query;
    }

    const docs = await query.orderBy(documents.createdAt);

    return Response.json({
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        docType: d.docType,
        fileName: d.fileName,
        fileSize: d.fileSize,
        status: d.status,
        chunkCount: d.chunkCount,
        hasOriginalFile: !!d.storageKey,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (error) {
    log.error({ event: 'list_error', error: error instanceof Error ? error.message : String(error) }, 'Failed to list documents');
    return Response.json(
      { error: 'Failed to list documents', code: 'LIST_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST Handler - Create and Process Document
// =============================================================================

export async function POST(request: NextRequest) {
  // Parse request body
  let body: CreateDocumentRequest;
  try {
    const json = await request.json();
    body = createDocumentSchema.parse(json);
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

  const { tenantSlug, title, content, url, docType, fileName, processImmediately } = body;

  // Get tenant service and database
  const tenantService = getTenantService();
  const tenant = await tenantService.getTenantWithSecrets(tenantSlug);

  if (!tenant) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  const tenantDb = await tenantService.getTenantDb(tenantSlug);
  if (!tenantDb) {
    return Response.json(
      { error: 'Failed to connect to tenant database', code: 'DB_ERROR' },
      { status: 500 }
    );
  }

  try {
    // Create document record
    const newDoc: NewDocument = {
      title,
      content,
      url,
      docType: docType ?? 'disclosure',
      fileName,
      fileSize: content.length,
      status: processImmediately ? 'processing' : 'pending',
    };

    const [doc] = await tenantDb.insert(documents).values(newDoc).returning();

    // Process document if requested
    if (processImmediately) {
      try {
        await processDocument(
          tenantDb,
          doc.id,
          doc.title,
          content,
          tenant.llmApiKey,
          tenant.ragConfig
        );

        // Update document status
        await tenantDb
          .update(documents)
          .set({ status: 'ready' })
          .where(eq(documents.id, doc.id));
      } catch (processError) {
        log.error({ event: 'processing_error', docId: doc.id, error: processError instanceof Error ? processError.message : String(processError) }, 'Document processing failed');
        // Update status to error
        await tenantDb
          .update(documents)
          .set({ status: 'error' })
          .where(eq(documents.id, doc.id));

        return Response.json(
          {
            document: { id: doc.id, status: 'error' },
            error: 'Document created but processing failed',
            code: 'PROCESSING_ERROR',
          },
          { status: 207 } // Multi-status
        );
      }
    }

    // Return created document
    const [updatedDoc] = await tenantDb
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);

    return Response.json(
      {
        document: {
          id: updatedDoc.id,
          title: updatedDoc.title,
          status: updatedDoc.status,
          chunkCount: updatedDoc.chunkCount,
          createdAt: updatedDoc.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    log.error({ event: 'create_error', error: error instanceof Error ? error.message : String(error) }, 'Failed to create document');
    return Response.json(
      { error: 'Failed to create document', code: 'CREATE_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// Document Processing
// =============================================================================

/**
 * Process a document: chunk, embed, and store.
 */
async function processDocument(
  db: TenantDatabase,
  docId: string,
  docTitle: string,
  content: string,
  llmApiKey: string | null,
  ragConfig: { chunkSize?: number; chunkOverlap?: number }
): Promise<void> {
  // 1. Chunk the document
  const chunks = chunkDocument(content, docId, {
    chunkSize: ragConfig.chunkSize ?? 500,
    chunkOverlap: ragConfig.chunkOverlap ?? 50,
  });

  if (chunks.length === 0) {
    throw new Error('Document produced no chunks');
  }

  // 2. Generate embeddings
  const embeddingService = createEmbeddingService(llmApiKey);
  const { embeddings } = await embeddingService.embedBatch(
    chunks.map((c) => c.content)
  );

  // 3. Store chunks with embeddings
  const chunkRecords: NewDocumentChunk[] = chunks.map((chunk, index) => ({
    docId,
    content: chunk.content,
    embedding: embeddings[index],
    chunkIndex: chunk.chunkIndex,
    startChar: chunk.startOffset,
    endChar: chunk.endOffset,
    docTitle,
  }));

  await db.insert(documentChunks).values(chunkRecords);

  // 4. Update document chunk count
  await db
    .update(documents)
    .set({ chunkCount: chunks.length })
    .where(eq(documents.id, docId));
}
