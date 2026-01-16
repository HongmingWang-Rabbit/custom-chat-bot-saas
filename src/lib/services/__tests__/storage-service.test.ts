/**
 * Tests for Storage Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StorageService,
  StorageError,
  createStorageService,
} from '../storage-service';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the Supabase client
const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockDownload = vi.fn();
const mockRemove = vi.fn();
const mockList = vi.fn();

const mockStorageFrom = vi.fn(() => ({
  upload: mockUpload,
  createSignedUrl: mockCreateSignedUrl,
  download: mockDownload,
  remove: mockRemove,
  list: mockList,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: mockStorageFrom,
    },
  })),
}));

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// StorageService Constructor Tests
// =============================================================================

describe('StorageService', () => {
  describe('constructor', () => {
    it('should create service with default bucket name', () => {
      const service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });

      expect(service).toBeInstanceOf(StorageService);
    });

    it('should create service with custom bucket name', () => {
      const service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
        bucketName: 'custom-bucket',
      });

      expect(service).toBeInstanceOf(StorageService);
    });
  });

  // ===========================================================================
  // uploadFile Tests
  // ===========================================================================

  describe('uploadFile', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should upload file successfully', async () => {
      const buffer = Buffer.from('test content');
      mockUpload.mockResolvedValueOnce({
        data: { path: 'doc-123/test.pdf' },
        error: null,
      });

      const result = await service.uploadFile(
        'doc-123',
        'test.pdf',
        buffer,
        'application/pdf'
      );

      expect(result.storageKey).toBe('doc-123/test.pdf');
      expect(result.size).toBe(buffer.length);
      expect(mockStorageFrom).toHaveBeenCalledWith('documents');
      expect(mockUpload).toHaveBeenCalledWith(
        'doc-123/test.pdf',
        buffer,
        expect.objectContaining({
          contentType: 'application/pdf',
          upsert: true,
        })
      );
    });

    it('should sanitize filename with spaces', async () => {
      const buffer = Buffer.from('test');
      mockUpload.mockResolvedValueOnce({
        data: { path: 'doc-123/my_test_file.pdf' },
        error: null,
      });

      await service.uploadFile(
        'doc-123',
        'my test file.pdf',
        buffer,
        'application/pdf'
      );

      expect(mockUpload).toHaveBeenCalledWith(
        'doc-123/my_test_file.pdf',
        expect.any(Buffer),
        expect.any(Object)
      );
    });

    it('should sanitize filename with special characters', async () => {
      const buffer = Buffer.from('test');
      mockUpload.mockResolvedValueOnce({
        data: { path: 'doc-123/report2024.pdf' },
        error: null,
      });

      await service.uploadFile(
        'doc-123',
        'report<2024>.pdf',
        buffer,
        'application/pdf'
      );

      expect(mockUpload).toHaveBeenCalledWith(
        'doc-123/report2024.pdf',
        expect.any(Buffer),
        expect.any(Object)
      );
    });

    it('should throw StorageError on upload failure', async () => {
      const buffer = Buffer.from('test');
      mockUpload.mockResolvedValue({
        data: null,
        error: { message: 'Bucket not found' },
      });

      await expect(
        service.uploadFile('doc-123', 'test.pdf', buffer, 'application/pdf')
      ).rejects.toThrow(StorageError);

      await expect(
        service.uploadFile('doc-123', 'test.pdf', buffer, 'application/pdf')
      ).rejects.toThrow(/Failed to upload file.*Bucket not found/);
    });

    it('should use custom bucket when specified', async () => {
      const customService = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
        bucketName: 'custom-bucket',
      });

      const buffer = Buffer.from('test');
      mockUpload.mockResolvedValueOnce({
        data: { path: 'doc-123/test.pdf' },
        error: null,
      });

      await customService.uploadFile(
        'doc-123',
        'test.pdf',
        buffer,
        'application/pdf'
      );

      expect(mockStorageFrom).toHaveBeenCalledWith('custom-bucket');
    });
  });

  // ===========================================================================
  // getSignedUrl Tests
  // ===========================================================================

  describe('getSignedUrl', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should generate signed URL with default expiration', async () => {
      mockCreateSignedUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.supabase.co/signed/test' },
        error: null,
      });

      const result = await service.getSignedUrl('doc-123/test.pdf');

      expect(result.signedUrl).toBe('https://storage.supabase.co/signed/test');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockCreateSignedUrl).toHaveBeenCalledWith(
        'doc-123/test.pdf',
        3600,
        { download: true }
      );
    });

    it('should generate signed URL with custom expiration', async () => {
      mockCreateSignedUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.supabase.co/signed/test' },
        error: null,
      });

      const result = await service.getSignedUrl('doc-123/test.pdf', 7200);

      expect(mockCreateSignedUrl).toHaveBeenCalledWith(
        'doc-123/test.pdf',
        7200,
        { download: true }
      );

      // Verify expiration is approximately 2 hours from now
      const expectedExpiry = Date.now() + 7200 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 1000);
      expect(result.expiresAt.getTime()).toBeLessThan(expectedExpiry + 1000);
    });

    it('should throw StorageError on signed URL failure', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'File not found' },
      });

      await expect(service.getSignedUrl('doc-123/test.pdf')).rejects.toThrow(
        StorageError
      );

      await expect(service.getSignedUrl('doc-123/test.pdf')).rejects.toThrow(
        /Failed to create signed URL.*File not found/
      );
    });
  });

  // ===========================================================================
  // downloadFile Tests
  // ===========================================================================

  describe('downloadFile', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should download file and return buffer', async () => {
      const content = 'test file content';
      const blob = new Blob([content]);

      mockDownload.mockResolvedValueOnce({
        data: blob,
        error: null,
      });

      const result = await service.downloadFile('doc-123/test.pdf');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe(content);
      expect(mockDownload).toHaveBeenCalled();
    });

    it('should throw StorageError on download failure', async () => {
      mockDownload.mockResolvedValue({
        data: null,
        error: { message: 'File not found' },
      });

      await expect(service.downloadFile('doc-123/test.pdf')).rejects.toThrow(
        StorageError
      );

      await expect(service.downloadFile('doc-123/test.pdf')).rejects.toThrow(
        /Failed to download file.*File not found/
      );
    });
  });

  // ===========================================================================
  // deleteFile Tests
  // ===========================================================================

  describe('deleteFile', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should delete file successfully', async () => {
      mockRemove.mockResolvedValueOnce({
        data: {},
        error: null,
      });

      await expect(
        service.deleteFile('doc-123/test.pdf')
      ).resolves.toBeUndefined();

      expect(mockRemove).toHaveBeenCalledWith(['doc-123/test.pdf']);
    });

    it('should throw StorageError on delete failure', async () => {
      mockRemove.mockResolvedValue({
        data: null,
        error: { message: 'Permission denied' },
      });

      await expect(service.deleteFile('doc-123/test.pdf')).rejects.toThrow(
        StorageError
      );

      await expect(service.deleteFile('doc-123/test.pdf')).rejects.toThrow(
        /Failed to delete file.*Permission denied/
      );
    });
  });

  // ===========================================================================
  // deleteDocumentFiles Tests
  // ===========================================================================

  describe('deleteDocumentFiles', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should delete all files for a document', async () => {
      mockList.mockResolvedValueOnce({
        data: [{ name: 'file1.pdf' }, { name: 'file2.pdf' }],
        error: null,
      });
      mockRemove.mockResolvedValueOnce({
        data: {},
        error: null,
      });

      await service.deleteDocumentFiles('doc-123');

      expect(mockList).toHaveBeenCalledWith('doc-123');
      expect(mockRemove).toHaveBeenCalledWith([
        'doc-123/file1.pdf',
        'doc-123/file2.pdf',
      ]);
    });

    it('should do nothing when no files exist', async () => {
      mockList.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      await service.deleteDocumentFiles('doc-123');

      expect(mockList).toHaveBeenCalledWith('doc-123');
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('should do nothing when data is null', async () => {
      mockList.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await service.deleteDocumentFiles('doc-123');

      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('should throw StorageError on list failure', async () => {
      mockList.mockResolvedValue({
        data: null,
        error: { message: 'Access denied' },
      });

      await expect(service.deleteDocumentFiles('doc-123')).rejects.toThrow(
        StorageError
      );

      await expect(service.deleteDocumentFiles('doc-123')).rejects.toThrow(
        /Failed to list document files.*Access denied/
      );
    });

    it('should throw StorageError on delete failure', async () => {
      mockList.mockResolvedValue({
        data: [{ name: 'file1.pdf' }],
        error: null,
      });
      mockRemove.mockResolvedValue({
        data: null,
        error: { message: 'Delete failed' },
      });

      await expect(service.deleteDocumentFiles('doc-123')).rejects.toThrow(
        StorageError
      );

      await expect(service.deleteDocumentFiles('doc-123')).rejects.toThrow(
        /Failed to delete document files.*Delete failed/
      );
    });
  });

  // ===========================================================================
  // listDocumentFiles Tests
  // ===========================================================================

  describe('listDocumentFiles', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should list files for a document', async () => {
      mockList.mockResolvedValueOnce({
        data: [
          { name: 'document.pdf' },
          { name: 'attachment.docx' },
        ],
        error: null,
      });

      const result = await service.listDocumentFiles('doc-123');

      expect(result).toEqual(['document.pdf', 'attachment.docx']);
      expect(mockList).toHaveBeenCalledWith('doc-123');
    });

    it('should return empty array when no files', async () => {
      mockList.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await service.listDocumentFiles('doc-123');

      expect(result).toEqual([]);
    });

    it('should return empty array when data is null', async () => {
      mockList.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await service.listDocumentFiles('doc-123');

      expect(result).toEqual([]);
    });

    it('should throw StorageError on list failure', async () => {
      mockList.mockResolvedValue({
        data: null,
        error: { message: 'Bucket not found' },
      });

      await expect(service.listDocumentFiles('doc-123')).rejects.toThrow(
        StorageError
      );

      await expect(service.listDocumentFiles('doc-123')).rejects.toThrow(
        /Failed to list document files.*Bucket not found/
      );
    });
  });

  // ===========================================================================
  // fileExists Tests
  // ===========================================================================

  describe('fileExists', () => {
    let service: StorageService;

    beforeEach(() => {
      service = new StorageService({
        apiUrl: 'https://test.supabase.co',
        serviceKey: 'test-key',
      });
    });

    it('should return true when file exists', async () => {
      mockList.mockResolvedValueOnce({
        data: [{ name: 'test.pdf' }, { name: 'other.pdf' }],
        error: null,
      });

      const result = await service.fileExists('doc-123/test.pdf');

      expect(result).toBe(true);
      expect(mockList).toHaveBeenCalledWith('doc-123');
    });

    it('should return false when file does not exist', async () => {
      mockList.mockResolvedValueOnce({
        data: [{ name: 'other.pdf' }],
        error: null,
      });

      const result = await service.fileExists('doc-123/test.pdf');

      expect(result).toBe(false);
    });

    it('should return false when folder is empty', async () => {
      mockList.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await service.fileExists('doc-123/test.pdf');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockList.mockResolvedValueOnce({
        data: null,
        error: { message: 'Error' },
      });

      const result = await service.fileExists('doc-123/test.pdf');

      expect(result).toBe(false);
    });

    it('should return false when list throws', async () => {
      mockList.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.fileExists('doc-123/test.pdf');

      expect(result).toBe(false);
    });

    it('should handle nested paths', async () => {
      mockList.mockResolvedValueOnce({
        data: [{ name: 'test.pdf' }],
        error: null,
      });

      const result = await service.fileExists('tenant/doc-123/test.pdf');

      expect(mockList).toHaveBeenCalledWith('tenant/doc-123');
      expect(result).toBe(true);
    });
  });
});

// =============================================================================
// StorageError Tests
// =============================================================================

describe('StorageError', () => {
  it('should create error with message', () => {
    const error = new StorageError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.name).toBe('StorageError');
    expect(error.cause).toBeUndefined();
  });

  it('should create error with cause', () => {
    const cause = new Error('Original error');
    const error = new StorageError('Wrapped error', cause);

    expect(error.message).toBe('Wrapped error');
    expect(error.cause).toBe(cause);
  });

  it('should be instanceof Error', () => {
    const error = new StorageError('Test');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(StorageError);
  });
});

// =============================================================================
// createStorageService Factory Tests
// =============================================================================

describe('createStorageService', () => {
  it('should create StorageService instance', () => {
    const service = createStorageService(
      'https://test.supabase.co',
      'test-key'
    );

    expect(service).toBeInstanceOf(StorageService);
  });

  it('should create StorageService with custom bucket', () => {
    const service = createStorageService(
      'https://test.supabase.co',
      'test-key',
      'custom-bucket'
    );

    expect(service).toBeInstanceOf(StorageService);
  });
});
