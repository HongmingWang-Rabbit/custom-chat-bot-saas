/**
 * Tests for Document Download API Route
 *
 * GET /api/documents/[id]/download
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

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
  Timer: class {
    elapsed() {
      return 100;
    }
    mark() {}
    measure() {}
    getDuration() {
      return 50;
    }
    getAllDurations() {
      return { tenant: 10, db_query: 20, signed_url: 30 };
    }
  },
}));

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Helper Functions
// =============================================================================

function createRequest(documentId: string, tenantSlug?: string): NextRequest {
  const url = tenantSlug
    ? `http://localhost:3000/api/documents/${documentId}/download?tenantSlug=${tenantSlug}`
    : `http://localhost:3000/api/documents/${documentId}/download`;

  return new NextRequest(url, {
    method: 'GET',
  });
}

function createParams(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  };
}

const mockDocument = {
  id: 'doc-123',
  title: 'Test Document',
  fileName: 'test.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  storageKey: 'doc-123/test.pdf',
  content: 'Test content',
  status: 'ready',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDocumentWithoutStorage = {
  ...mockDocument,
  storageKey: null,
};

// =============================================================================
// Validation Tests
// =============================================================================

describe('GET /api/documents/[id]/download', () => {
  describe('Validation', () => {
    it('should return 400 when tenantSlug is missing', async () => {
      const request = createRequest('doc-123');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('tenantSlug query parameter is required');
      expect(data.code).toBe('MISSING_TENANT');
      expect(response.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });

    it('should return 400 when document ID is empty', async () => {
      const request = createRequest('', 'test-tenant');
      const params = createParams('');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Document ID is required');
      expect(data.code).toBe('MISSING_DOCUMENT_ID');
    });
  });

  // ===========================================================================
  // Tenant Tests
  // ===========================================================================

  describe('Tenant Resolution', () => {
    it('should return 404 when tenant not found', async () => {
      mockGetTenantDb.mockResolvedValue(null);

      const request = createRequest('doc-123', 'nonexistent-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Tenant not found');
      expect(data.code).toBe('TENANT_NOT_FOUND');
      expect(mockGetTenantDb).toHaveBeenCalledWith('nonexistent-tenant');
    });
  });

  // ===========================================================================
  // Document Tests
  // ===========================================================================

  describe('Document Resolution', () => {
    it('should return 404 when document not found', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createRequest('nonexistent-doc', 'test-tenant');
      const params = createParams('nonexistent-doc');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Document not found');
      expect(data.code).toBe('NOT_FOUND');
    });

    it('should return 404 when document has no storage key', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocumentWithoutStorage]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No original file stored for this document');
      expect(data.code).toBe('NO_FILE_STORED');
      expect(data.document).toEqual({
        id: mockDocumentWithoutStorage.id,
        title: mockDocumentWithoutStorage.title,
        fileName: mockDocumentWithoutStorage.fileName,
      });
    });
  });

  // ===========================================================================
  // Storage Service Tests
  // ===========================================================================

  describe('Storage Service', () => {
    it('should return 503 when storage service is unavailable', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe('Storage service unavailable');
      expect(data.code).toBe('STORAGE_UNAVAILABLE');
    });

    it('should return 500 when signed URL generation fails', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        getSignedUrl: vi.fn().mockRejectedValue(new Error('Storage error')),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to generate download URL');
      expect(data.code).toBe('DOWNLOAD_ERROR');
    });
  });

  // ===========================================================================
  // Success Tests
  // ===========================================================================

  describe('Successful Download', () => {
    it('should return signed URL when all conditions are met', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const mockStorageService = {
        getSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://storage.supabase.co/signed/doc-123/test.pdf?token=abc',
          expiresAt,
        }),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document).toEqual({
        id: mockDocument.id,
        title: mockDocument.title,
        fileName: mockDocument.fileName,
        mimeType: mockDocument.mimeType,
        fileSize: mockDocument.fileSize,
      });
      expect(data.download.url).toBe(
        'https://storage.supabase.co/signed/doc-123/test.pdf?token=abc'
      );
      expect(data.download.expiresAt).toBe(expiresAt.toISOString());
      expect(data.download.expiresInSeconds).toBe(3600);
      expect(data.debug.traceId).toBe('test-trace-id');
      expect(response.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });

    it('should call getSignedUrl with correct parameters', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        getSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed',
          expiresAt: new Date(),
        }),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      await GET(request, params);

      expect(mockStorageService.getSignedUrl).toHaveBeenCalledWith(
        mockDocument.storageKey,
        3600
      );
    });

    it('should call tenant service with correct tenant slug', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockDocument]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        getSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed',
          expiresAt: new Date(),
        }),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createRequest('doc-123', 'my-tenant');
      const params = createParams('doc-123');

      await GET(request, params);

      expect(mockGetTenantDb).toHaveBeenCalledWith('my-tenant');
      expect(mockGetStorageService).toHaveBeenCalledWith('my-tenant');
    });
  });

  // ===========================================================================
  // Response Headers Tests
  // ===========================================================================

  describe('Response Headers', () => {
    it('should include X-Trace-Id header in all responses', async () => {
      // Test 400 response
      const request400 = createRequest('doc-123');
      const params400 = createParams('doc-123');
      const response400 = await GET(request400, params400);
      expect(response400.headers.get('X-Trace-Id')).toBe('test-trace-id');

      // Test 404 response
      mockGetTenantDb.mockResolvedValue(null);
      const request404 = createRequest('doc-123', 'test-tenant');
      const params404 = createParams('doc-123');
      const response404 = await GET(request404, params404);
      expect(response404.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });

    it('should include debug info in all responses', async () => {
      mockGetTenantDb.mockResolvedValue(null);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(data.debug).toBeDefined();
      expect(data.debug.traceId).toBe('test-trace-id');
      expect(data.debug.total_ms).toBeDefined();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle document with null optional fields', async () => {
      const docWithNulls = {
        ...mockDocument,
        mimeType: null,
        fileSize: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([docWithNulls]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        getSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed',
          expiresAt: new Date(),
        }),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createRequest('doc-123', 'test-tenant');
      const params = createParams('doc-123');

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document.mimeType).toBeNull();
      expect(data.document.fileSize).toBeNull();
    });

    it('should handle special characters in tenant slug', async () => {
      mockGetTenantDb.mockResolvedValue(null);

      const request = createRequest('doc-123', 'tenant-with-dashes');
      const params = createParams('doc-123');

      await GET(request, params);

      expect(mockGetTenantDb).toHaveBeenCalledWith('tenant-with-dashes');
    });

    it('should handle UUID document IDs', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const docWithUuid = { ...mockDocument, id: uuid };

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([docWithUuid]),
      };
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        getSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://example.com/signed',
          expiresAt: new Date(),
        }),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const request = createRequest(uuid, 'test-tenant');
      const params = createParams(uuid);

      const response = await GET(request, params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.document.id).toBe(uuid);
    });
  });
});
