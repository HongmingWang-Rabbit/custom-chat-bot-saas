/**
 * Tests for Document Detail API Route
 *
 * GET /api/documents/[id] - Get document details
 * PATCH /api/documents/[id] - Update document metadata
 * DELETE /api/documents/[id] - Delete document and its chunks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '../route';

// =============================================================================
// Mocks
// =============================================================================

// Mock tenant service
const mockGetTenantDb = vi.fn();
const mockGetStorageService = vi.fn();

vi.mock('@/lib/services/tenant-service', () => ({
  getTenantService: () => ({
    getTenantDb: mockGetTenantDb,
    getStorageService: mockGetStorageService,
  }),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createRequestContext: () => ({ traceId: 'test-trace-id' }),
  createLayerLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logDbOperation: vi.fn(),
  logAdminAction: vi.fn(),
  Timer: class {
    elapsed() {
      return 100;
    }
    mark() {}
    measure() {}
    getDuration() {
      return 50;
    }
  },
}));

// =============================================================================
// Test Setup
// =============================================================================

const mockDocumentId = '550e8400-e29b-41d4-a716-446655440000';

const mockDocument = {
  id: mockDocumentId,
  title: 'Test Document',
  url: 'https://example.com/doc',
  docType: 'disclosure',
  fileName: 'test.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  status: 'ready',
  chunkCount: 5,
  storageKey: 'documents/test.pdf',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
};

const mockChunks = [
  { id: 'chunk-1', docId: mockDocumentId, content: 'Chunk 1' },
  { id: 'chunk-2', docId: mockDocumentId, content: 'Chunk 2' },
];

function createMockDb(document = mockDocument, chunks = mockChunks) {
  const selectResult = document ? [document] : [];
  const deleteChunksResult = chunks;

  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(document ? [document] : []),
    delete: vi.fn().mockReturnThis(),
    // For delete operations, we need different return values
    _deleteReturning: vi.fn()
      .mockResolvedValueOnce(deleteChunksResult) // First call: chunks
      .mockResolvedValueOnce([document]), // Second call: document
  };
}

function createGetRequest(documentId: string, tenantSlug?: string): NextRequest {
  const url = tenantSlug
    ? `http://localhost:3000/api/documents/${documentId}?tenantSlug=${tenantSlug}`
    : `http://localhost:3000/api/documents/${documentId}`;
  return new NextRequest(url, { method: 'GET' });
}

function createPatchRequest(
  documentId: string,
  body: Record<string, unknown>,
  tenantSlug?: string
): NextRequest {
  const url = tenantSlug
    ? `http://localhost:3000/api/documents/${documentId}?tenantSlug=${tenantSlug}`
    : `http://localhost:3000/api/documents/${documentId}`;
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(documentId: string, tenantSlug?: string): NextRequest {
  const url = tenantSlug
    ? `http://localhost:3000/api/documents/${documentId}?tenantSlug=${tenantSlug}`
    : `http://localhost:3000/api/documents/${documentId}`;
  return new NextRequest(url, { method: 'DELETE' });
}

const createParams = (id: string) => Promise.resolve({ id });

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// GET Handler Tests
// =============================================================================

describe('GET /api/documents/[id]', () => {
  describe('Validation', () => {
    it('should return 400 when tenantSlug is missing', async () => {
      const request = createGetRequest(mockDocumentId);

      const response = await GET(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('tenantSlug query parameter is required');
      expect(data.code).toBe('MISSING_TENANT');
    });

    it('should return 404 when tenant not found', async () => {
      mockGetTenantDb.mockResolvedValue(null);

      const request = createGetRequest(mockDocumentId, 'nonexistent');

      const response = await GET(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Tenant not found');
      expect(data.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('Document Retrieval', () => {
    it('should return 404 when document not found', async () => {
      const mockDb = createMockDb(null);
      mockDb.limit.mockResolvedValue([]);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createGetRequest(mockDocumentId, 'test-tenant');

      const response = await GET(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Document not found');
      expect(data.code).toBe('NOT_FOUND');
    });

    it('should return document details on success', async () => {
      const mockDb = createMockDb();
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createGetRequest(mockDocumentId, 'test-tenant');

      const response = await GET(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document).toBeDefined();
      expect(data.document.id).toBe(mockDocumentId);
      expect(data.document.title).toBe('Test Document');
      expect(data.document.docType).toBe('disclosure');
      expect(data.document.status).toBe('ready');
      expect(data.document.chunkCount).toBe(5);
      expect(data.document.hasOriginalFile).toBe(true);
    });

    it('should return hasOriginalFile as false when no storageKey', async () => {
      const docWithoutStorage = { ...mockDocument, storageKey: null };
      const mockDb = createMockDb(docWithoutStorage);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createGetRequest(mockDocumentId, 'test-tenant');

      const response = await GET(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document.hasOriginalFile).toBe(false);
    });

    it('should return 500 on database error', async () => {
      const mockDb = createMockDb();
      mockDb.limit.mockRejectedValue(new Error('Database error'));
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createGetRequest(mockDocumentId, 'test-tenant');

      const response = await GET(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('GET_ERROR');
    });
  });
});

// =============================================================================
// PATCH Handler Tests
// =============================================================================

describe('PATCH /api/documents/[id]', () => {
  describe('Validation', () => {
    it('should return 400 when tenantSlug is missing', async () => {
      const request = createPatchRequest(mockDocumentId, { title: 'New Title' });

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_TENANT');
    });

    it('should return 400 when body is invalid JSON', async () => {
      const url = `http://localhost:3000/api/documents/${mockDocumentId}?tenantSlug=test`;
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('should return 400 when title is empty string', async () => {
      mockGetTenantDb.mockResolvedValue(createMockDb());

      const request = createPatchRequest(mockDocumentId, { title: '' }, 'test-tenant');

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when title exceeds max length', async () => {
      mockGetTenantDb.mockResolvedValue(createMockDb());

      const longTitle = 'a'.repeat(501);
      const request = createPatchRequest(mockDocumentId, { title: longTitle }, 'test-tenant');

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when docType is invalid', async () => {
      mockGetTenantDb.mockResolvedValue(createMockDb());

      const request = createPatchRequest(
        mockDocumentId,
        { docType: 'invalid-type' },
        'test-tenant'
      );

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 when tenant not found', async () => {
      mockGetTenantDb.mockResolvedValue(null);

      const request = createPatchRequest(mockDocumentId, { title: 'New Title' }, 'nonexistent');

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('Document Update', () => {
    it('should return 404 when document not found', async () => {
      const mockDb = createMockDb(null);
      mockDb.limit.mockResolvedValue([]);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createPatchRequest(mockDocumentId, { title: 'New Title' }, 'test-tenant');

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('NOT_FOUND');
    });

    it('should update title successfully', async () => {
      const updatedDoc = { ...mockDocument, title: 'Updated Title' };
      const mockDb = createMockDb();
      mockDb.returning.mockResolvedValue([updatedDoc]);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createPatchRequest(
        mockDocumentId,
        { title: 'Updated Title' },
        'test-tenant'
      );

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document.title).toBe('Updated Title');
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
    });

    it('should update docType successfully', async () => {
      const updatedDoc = { ...mockDocument, docType: 'report' };
      const mockDb = createMockDb();
      mockDb.returning.mockResolvedValue([updatedDoc]);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createPatchRequest(mockDocumentId, { docType: 'report' }, 'test-tenant');

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document.docType).toBe('report');
    });

    it('should update both title and docType', async () => {
      const updatedDoc = { ...mockDocument, title: 'New Title', docType: 'faq' };
      const mockDb = createMockDb();
      mockDb.returning.mockResolvedValue([updatedDoc]);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createPatchRequest(
        mockDocumentId,
        { title: 'New Title', docType: 'faq' },
        'test-tenant'
      );

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document.title).toBe('New Title');
      expect(data.document.docType).toBe('faq');
    });

    it('should accept all valid docType values', async () => {
      const validDocTypes = ['disclosure', 'faq', 'report', 'filing', 'other'];

      for (const docType of validDocTypes) {
        vi.clearAllMocks();
        const updatedDoc = { ...mockDocument, docType };
        const mockDb = createMockDb();
        mockDb.returning.mockResolvedValue([updatedDoc]);
        mockGetTenantDb.mockResolvedValue(mockDb);

        const request = createPatchRequest(mockDocumentId, { docType }, 'test-tenant');

        const response = await PATCH(request, { params: createParams(mockDocumentId) });

        expect(response.status).toBe(200);
      }
    });

    it('should return 500 on database error', async () => {
      const mockDb = createMockDb();
      mockDb.returning.mockRejectedValue(new Error('Database error'));
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createPatchRequest(mockDocumentId, { title: 'New Title' }, 'test-tenant');

      const response = await PATCH(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('UPDATE_ERROR');
    });
  });
});

// =============================================================================
// DELETE Handler Tests
// =============================================================================

describe('DELETE /api/documents/[id]', () => {
  describe('Validation', () => {
    it('should return 400 when tenantSlug is missing', async () => {
      const request = createDeleteRequest(mockDocumentId);

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_TENANT');
    });

    it('should return 404 when tenant not found', async () => {
      mockGetTenantDb.mockResolvedValue(null);

      const request = createDeleteRequest(mockDocumentId, 'nonexistent');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('Document Deletion', () => {
    it('should return 404 when document not found', async () => {
      const mockDb = createMockDb(null);
      mockDb.limit.mockResolvedValue([]);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('NOT_FOUND');
    });

    it('should delete document and chunks successfully', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn()
          .mockResolvedValueOnce(mockChunks) // First call: delete chunks
          .mockResolvedValueOnce([mockDocument]), // Second call: delete document
      };
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deleted.documentId).toBe(mockDocumentId);
      expect(data.deleted.title).toBe('Test Document');
      expect(data.deleted.chunksDeleted).toBe(2);
      expect(data.deleted.fileDeleted).toBe(true);
      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });

    it('should delete storage file when present', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn()
          .mockResolvedValueOnce(mockChunks)
          .mockResolvedValueOnce([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        deleteFile: vi.fn().mockResolvedValue(undefined),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockStorageService.deleteFile).toHaveBeenCalledWith('documents/test.pdf');
      expect(data.deleted.fileDeleted).toBe(true);
    });

    it('should continue when storage deletion fails', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn()
          .mockResolvedValueOnce(mockChunks)
          .mockResolvedValueOnce([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        deleteFile: vi.fn().mockRejectedValue(new Error('Storage error')),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      // Should still succeed - storage deletion is non-critical
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should skip storage deletion when no storageKey', async () => {
      const docWithoutStorage = { ...mockDocument, storageKey: null };
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([docWithoutStorage]),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn()
          .mockResolvedValueOnce(mockChunks)
          .mockResolvedValueOnce([docWithoutStorage]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        deleteFile: vi.fn(),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
      expect(data.deleted.fileDeleted).toBe(false);
    });

    it('should handle document with no chunks', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn()
          .mockResolvedValueOnce([]) // No chunks
          .mockResolvedValueOnce([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deleted.chunksDeleted).toBe(0);
    });

    it('should return 500 on database error', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
        delete: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(new Error('Database error')),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const request = createDeleteRequest(mockDocumentId, 'test-tenant');

      const response = await DELETE(request, { params: createParams(mockDocumentId) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('DELETE_ERROR');
    });
  });
});
