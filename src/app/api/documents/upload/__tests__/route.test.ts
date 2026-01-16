/**
 * Tests for Document Upload API Route
 *
 * POST /api/documents/upload
 * GET /api/documents/upload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

// =============================================================================
// Mocks
// =============================================================================

// Mock crypto.randomUUID
const mockUUID = '550e8400-e29b-41d4-a716-446655440000';
vi.stubGlobal('crypto', {
  randomUUID: () => mockUUID,
});

// Mock tenant service
const mockGetTenantWithSecrets = vi.fn();
const mockGetTenantDb = vi.fn();
const mockGetStorageService = vi.fn();

vi.mock('@/lib/services/tenant-service', () => ({
  getTenantService: () => ({
    getTenantWithSecrets: mockGetTenantWithSecrets,
    getTenantDb: mockGetTenantDb,
    getStorageService: mockGetStorageService,
  }),
}));

// Mock parsers
const mockParseFile = vi.fn();
const mockValidateFile = vi.fn();
const mockGetMimeType = vi.fn();

vi.mock('@/lib/parsers', () => ({
  parseFile: (...args: unknown[]) => mockParseFile(...args),
  validateFile: (...args: unknown[]) => mockValidateFile(...args),
  getMimeType: (...args: unknown[]) => mockGetMimeType(...args),
  SUPPORTED_EXTENSIONS: ['.pdf', '.txt', '.md', '.docx'],
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}));

// Mock RAG services
const mockChunkDocument = vi.fn();
const mockEmbedBatch = vi.fn();

vi.mock('@/lib/rag', () => ({
  chunkDocument: (...args: unknown[]) => mockChunkDocument(...args),
  createEmbeddingService: () => ({
    embedBatch: mockEmbedBatch,
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
  logExternalCall: vi.fn(),
  logRagStep: vi.fn(),
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
    getAllDurations() {
      return { tenant: 10, parse: 20, db_insert: 30 };
    }
  },
  truncateText: (text: string) => text,
}));

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock implementations
  mockValidateFile.mockReturnValue({ valid: true });
  mockGetMimeType.mockReturnValue('application/pdf');
  mockParseFile.mockResolvedValue({
    content: 'Test document content',
    metadata: { pages: 1, wordCount: 3 },
  });
  mockChunkDocument.mockReturnValue([
    {
      content: 'Test document content',
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 21,
    },
  ]);
  mockEmbedBatch.mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3]],
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

function createFormData(fields: Record<string, string | File>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return formData;
}

function createMockFile(
  name: string,
  content: string = 'test content',
  type: string = 'application/pdf'
): File {
  return new File([content], name, { type });
}

async function createPostRequest(formData: FormData): Promise<NextRequest> {
  return new NextRequest('http://localhost:3000/api/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

const mockTenant = {
  id: 'tenant-123',
  slug: 'test-tenant',
  name: 'Test Tenant',
  llmApiKey: 'sk-test-key',
  ragConfig: { chunkSize: 500, chunkOverlap: 50 },
};

const mockDocument = {
  id: mockUUID,
  title: 'Test Document',
  fileName: 'test.pdf',
  fileSize: 1024,
  status: 'ready',
  chunkCount: 1,
  storageKey: null,
  createdAt: new Date(),
};

function createMockDb(returnDoc = mockDocument) {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returnDoc]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([returnDoc]),
  };
}

// =============================================================================
// GET Handler Tests
// =============================================================================

describe('GET /api/documents/upload', () => {
  it('should return upload info with supported types', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.supportedTypes).toEqual(['.pdf', '.txt', '.md', '.docx']);
    expect(data.maxFileSize).toBe(10 * 1024 * 1024);
    expect(data.maxFileSizeMB).toBe('10MB');
    expect(data.fields).toBeDefined();
    expect(data.fields.file).toContain('required');
    expect(data.fields.tenantSlug).toContain('required');
  });
});

// =============================================================================
// POST Handler - Validation Tests
// =============================================================================

describe('POST /api/documents/upload', () => {
  describe('Form Data Validation', () => {
    it('should return 400 when form data is invalid', async () => {
      // Create request with invalid body
      const request = new NextRequest('http://localhost:3000/api/documents/upload', {
        method: 'POST',
        body: 'invalid body',
        headers: { 'Content-Type': 'text/plain' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_FORM_DATA');
    });

    it('should return 400 when file is missing', async () => {
      const formData = createFormData({ tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('No file provided');
      expect(data.code).toBe('MISSING_FILE');
      expect(data.supportedTypes).toBeDefined();
    });

    it('should return 400 when tenantSlug is missing', async () => {
      const file = createMockFile('test.pdf');
      const formData = createFormData({ file });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('tenantSlug is required');
      expect(data.code).toBe('MISSING_TENANT');
    });

    it('should return 400 when file type is invalid', async () => {
      mockValidateFile.mockReturnValue({
        valid: false,
        error: 'Unsupported file type: .exe',
      });

      const file = createMockFile('malware.exe', 'bad content', 'application/x-executable');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Unsupported file type: .exe');
      expect(data.code).toBe('INVALID_FILE');
      expect(data.supportedTypes).toBeDefined();
      expect(data.maxSize).toBeDefined();
    });

    it('should return 400 when file is too large', async () => {
      mockValidateFile.mockReturnValue({
        valid: false,
        error: 'File size exceeds maximum allowed size',
      });

      const file = createMockFile('large.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_FILE');
    });
  });

  // ===========================================================================
  // Tenant Resolution Tests
  // ===========================================================================

  describe('Tenant Resolution', () => {
    it('should return 404 when tenant not found', async () => {
      mockGetTenantWithSecrets.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'nonexistent' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Tenant not found');
      expect(data.code).toBe('TENANT_NOT_FOUND');
    });

    it('should return 500 when tenant database connection fails', async () => {
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to connect to tenant database');
      expect(data.code).toBe('DB_ERROR');
    });
  });

  // ===========================================================================
  // File Parsing Tests
  // ===========================================================================

  describe('File Parsing', () => {
    it('should return 400 when file content is empty', async () => {
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(createMockDb());
      mockGetStorageService.mockResolvedValue(null);
      mockParseFile.mockResolvedValue({
        content: '   ',
        metadata: {},
      });

      const file = createMockFile('empty.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('File contains no extractable text');
      expect(data.code).toBe('EMPTY_CONTENT');
    });

    it('should return 500 when file parsing throws', async () => {
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(createMockDb());
      mockGetStorageService.mockResolvedValue(null);
      mockParseFile.mockRejectedValue(new Error('Parse error'));

      const file = createMockFile('corrupt.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('UPLOAD_ERROR');
    });
  });

  // ===========================================================================
  // Document Processing Tests
  // ===========================================================================

  describe('Document Processing', () => {
    it('should return 207 when processing fails but upload succeeds', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);
      mockChunkDocument.mockReturnValue([]);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(207);
      expect(data.error).toBe('File uploaded but processing failed');
      expect(data.code).toBe('PROCESSING_ERROR');
      expect(data.document).toBeDefined();
      expect(data.document.status).toBe('error');
    });

    it('should return 207 when embedding generation fails', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);
      mockEmbedBatch.mockRejectedValue(new Error('OpenAI API error'));

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(207);
      expect(data.code).toBe('PROCESSING_ERROR');
    });
  });

  // ===========================================================================
  // Storage Tests
  // ===========================================================================

  describe('Storage Handling', () => {
    it('should continue without storage when not configured', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.document.hasOriginalFile).toBe(false);
    });

    it('should continue when storage upload fails', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        uploadFile: vi.fn().mockRejectedValue(new Error('Storage error')),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(mockStorageService.uploadFile).toHaveBeenCalled();
    });

    it('should include storage key when upload succeeds', async () => {
      const docWithStorage = {
        ...mockDocument,
        storageKey: `${mockUUID}/test.pdf`,
      };
      const mockDb = createMockDb(docWithStorage);
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);

      const mockStorageService = {
        uploadFile: vi.fn().mockResolvedValue({
          storageKey: `${mockUUID}/test.pdf`,
          size: 1024,
        }),
      };
      mockGetStorageService.mockResolvedValue(mockStorageService);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        mockUUID,
        'test.pdf',
        expect.any(Buffer),
        'application/pdf'
      );
    });
  });

  // ===========================================================================
  // Successful Upload Tests
  // ===========================================================================

  describe('Successful Upload', () => {
    it('should return 201 with document details on success', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({
        file,
        tenantSlug: 'test-tenant',
        title: 'My Document',
        docType: 'report',
      });
      const request = await createPostRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.document).toBeDefined();
      expect(data.document.id).toBe(mockUUID);
      expect(data.document.status).toBe('ready');
      expect(data.metadata).toBeDefined();
      expect(data.debug.traceId).toBe('test-trace-id');
      expect(response.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });

    it('should use filename as title when title not provided', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('quarterly-report.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      await POST(request);

      // Check that insert was called with title derived from filename
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'quarterly-report',
        })
      );
    });

    it('should use provided title when specified', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('file.pdf');
      const formData = createFormData({
        file,
        tenantSlug: 'test-tenant',
        title: 'Custom Title',
      });
      const request = await createPostRequest(formData);

      await POST(request);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Custom Title',
        })
      );
    });

    it('should use default docType when not provided', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      await POST(request);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          docType: 'disclosure',
        })
      );
    });

    it('should include URL when provided', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({
        file,
        tenantSlug: 'test-tenant',
        url: 'https://example.com/source',
      });
      const request = await createPostRequest(formData);

      await POST(request);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/source',
        })
      );
    });

    it('should call chunking with correct config', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue({
        ...mockTenant,
        ragConfig: { chunkSize: 1000, chunkOverlap: 100 },
      });
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      await POST(request);

      expect(mockChunkDocument).toHaveBeenCalledWith(
        'Test document content',
        mockUUID,
        { chunkSize: 1000, chunkOverlap: 100 }
      );
    });
  });

  // ===========================================================================
  // Response Headers Tests
  // ===========================================================================

  describe('Response Headers', () => {
    it('should include X-Trace-Id in all responses', async () => {
      // Test 400 response
      const formData400 = createFormData({ tenantSlug: 'test' });
      const request400 = await createPostRequest(formData400);
      const response400 = await POST(request400);
      expect(response400.headers.get('X-Trace-Id')).toBe('test-trace-id');

      // Test 404 response
      mockGetTenantWithSecrets.mockResolvedValue(null);
      const file = createMockFile('test.pdf');
      const formData404 = createFormData({ file, tenantSlug: 'test' });
      const request404 = await createPostRequest(formData404);
      const response404 = await POST(request404);
      expect(response404.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });

    it('should include debug timing info in successful response', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);
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
    it('should handle files with special characters in name', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('report (2024) final.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('should handle markdown files', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);
      mockGetMimeType.mockReturnValue('text/markdown');

      const file = createMockFile('readme.md', '# Hello World', 'text/markdown');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'readme.md',
        })
      );
    });

    it('should handle text files', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);
      mockGetMimeType.mockReturnValue('text/plain');

      const file = createMockFile('notes.txt', 'Some notes', 'text/plain');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('should handle tenant with no LLM API key', async () => {
      const mockDb = createMockDb();
      mockGetTenantWithSecrets.mockResolvedValue({
        ...mockTenant,
        llmApiKey: null,
      });
      mockGetTenantDb.mockResolvedValue(mockDb);
      mockGetStorageService.mockResolvedValue(null);

      const file = createMockFile('test.pdf');
      const formData = createFormData({ file, tenantSlug: 'test-tenant' });
      const request = await createPostRequest(formData);

      const response = await POST(request);

      // Should still work - embedding service handles null key
      expect(response.status).toBe(201);
    });

    it('should handle all docType values', async () => {
      const docTypes = ['disclosure', 'faq', 'report', 'filing', 'other'];

      for (const docType of docTypes) {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        mockGetTenantWithSecrets.mockResolvedValue(mockTenant);
        mockGetTenantDb.mockResolvedValue(mockDb);
        mockGetStorageService.mockResolvedValue(null);
        mockValidateFile.mockReturnValue({ valid: true });
        mockParseFile.mockResolvedValue({
          content: 'Test content',
          metadata: {},
        });
        mockChunkDocument.mockReturnValue([
          { content: 'Test', chunkIndex: 0, startOffset: 0, endOffset: 4 },
        ]);
        mockEmbedBatch.mockResolvedValue({ embeddings: [[0.1]] });

        const file = createMockFile('test.pdf');
        const formData = createFormData({
          file,
          tenantSlug: 'test-tenant',
          docType,
        });
        const request = await createPostRequest(formData);

        const response = await POST(request);

        expect(response.status).toBe(201);
        expect(mockDb.values).toHaveBeenCalledWith(
          expect.objectContaining({ docType })
        );
      }
    });
  });
});
