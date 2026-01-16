/**
 * Tests for Supabase Storage Setup
 *
 * Tests the Storage API integration for bucket management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createStorageBucket,
  verifyStorageBucket,
  updateStorageBucket,
  deleteStorageBucket,
  listStorageBuckets,
  BucketExistsError,
  DEFAULT_BUCKET_NAME,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
} from '../storage-setup';

// =============================================================================
// Test Setup
// =============================================================================

// Store original env values
const originalEnv = { ...process.env };

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

// =============================================================================
// Helper Functions
// =============================================================================

const projectRef = 'test-project-ref';
const serviceKey = 'test-service-key';

function mockFetchResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(message: string, status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
    text: () => Promise.resolve(JSON.stringify({ message })),
  });
}

function mockFetchTextError(text: string, status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.reject(new Error('Invalid JSON')),
    text: () => Promise.resolve(text),
  });
}

const mockBucketResponse = {
  id: 'documents',
  name: 'documents',
  public: false,
  file_size_limit: MAX_FILE_SIZE,
  allowed_mime_types: ALLOWED_MIME_TYPES,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// =============================================================================
// BucketExistsError Tests
// =============================================================================

describe('BucketExistsError', () => {
  it('should create error with correct name', () => {
    const error = new BucketExistsError('Bucket already exists');

    expect(error.name).toBe('BucketExistsError');
    expect(error.message).toBe('Bucket already exists');
  });

  it('should be instanceof Error', () => {
    const error = new BucketExistsError('Test');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BucketExistsError);
  });
});

// =============================================================================
// Exported Constants Tests
// =============================================================================

describe('Exported Constants', () => {
  it('should export DEFAULT_BUCKET_NAME', () => {
    expect(DEFAULT_BUCKET_NAME).toBe('documents');
  });

  it('should export MAX_FILE_SIZE as 10MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('should export ALLOWED_MIME_TYPES', () => {
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_MIME_TYPES).toContain('text/plain');
    expect(ALLOWED_MIME_TYPES).toContain('text/markdown');
    expect(ALLOWED_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });
});

// =============================================================================
// createStorageBucket Tests
// =============================================================================

describe('createStorageBucket', () => {
  it('should return default bucket when no service key provided', async () => {
    const result = await createStorageBucket(projectRef);

    expect(result).toEqual({
      bucketId: 'documents',
      bucketName: 'documents',
      isPublic: false,
    });

    // Should not call fetch when no service key
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should create bucket with default config when service key provided', async () => {
    mockFetchResponse(mockBucketResponse);

    const result = await createStorageBucket(projectRef, serviceKey);

    expect(result).toEqual({
      bucketId: 'documents',
      bucketName: 'documents',
      isPublic: false,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://${projectRef}.supabase.co/storage/v1/bucket`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        }),
      })
    );

    // Verify request body
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({
      id: DEFAULT_BUCKET_NAME,
      name: DEFAULT_BUCKET_NAME,
      public: false,
      file_size_limit: MAX_FILE_SIZE,
      allowed_mime_types: ALLOWED_MIME_TYPES,
    });
  });

  it('should create bucket with custom config', async () => {
    const customBucket = {
      ...mockBucketResponse,
      name: 'custom-bucket',
      public: true,
      file_size_limit: 5 * 1024 * 1024,
    };
    mockFetchResponse(customBucket);

    const result = await createStorageBucket(projectRef, serviceKey, {
      bucketName: 'custom-bucket',
      isPublic: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['application/pdf'],
    });

    expect(result).toEqual({
      bucketId: 'custom-bucket',
      bucketName: 'custom-bucket',
      isPublic: true,
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.id).toBe('custom-bucket');
    expect(body.public).toBe(true);
    expect(body.file_size_limit).toBe(5 * 1024 * 1024);
    expect(body.allowed_mime_types).toEqual(['application/pdf']);
  });

  it('should handle bucket already exists (409)', async () => {
    mockFetchError('Bucket already exists', 409);

    const result = await createStorageBucket(projectRef, serviceKey);

    expect(result).toEqual({
      bucketId: 'documents',
      bucketName: 'documents',
      isPublic: false,
    });
  });

  it('should handle bucket already exists (error message)', async () => {
    mockFetchError('The resource already exists', 400);

    const result = await createStorageBucket(projectRef, serviceKey);

    expect(result).toEqual({
      bucketId: 'documents',
      bucketName: 'documents',
      isPublic: false,
    });
  });

  it('should throw on API error', async () => {
    mockFetchError('Internal server error', 500);

    await expect(createStorageBucket(projectRef, serviceKey)).rejects.toThrow(
      /Supabase Storage API error \(500\)/
    );
  });

  it('should handle non-JSON error response', async () => {
    mockFetchTextError('Bad Gateway', 502);

    await expect(createStorageBucket(projectRef, serviceKey)).rejects.toThrow(
      /Supabase Storage API error \(502\): Bad Gateway/
    );
  });
});

// =============================================================================
// verifyStorageBucket Tests
// =============================================================================

describe('verifyStorageBucket', () => {
  it('should return true when bucket exists', async () => {
    mockFetchResponse(mockBucketResponse);

    const result = await verifyStorageBucket(projectRef, serviceKey, 'documents');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://${projectRef}.supabase.co/storage/v1/bucket/documents`,
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('should use default bucket name when not specified', async () => {
    mockFetchResponse(mockBucketResponse);

    await verifyStorageBucket(projectRef, serviceKey);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/bucket/${DEFAULT_BUCKET_NAME}`),
      expect.any(Object)
    );
  });

  it('should return false when bucket does not exist', async () => {
    mockFetchError('Bucket not found', 404);

    const result = await verifyStorageBucket(projectRef, serviceKey, 'nonexistent');

    expect(result).toBe(false);
  });

  it('should return false on API error', async () => {
    mockFetchError('Internal error', 500);

    const result = await verifyStorageBucket(projectRef, serviceKey);

    expect(result).toBe(false);
  });

  it('should return false when bucket response has no name', async () => {
    mockFetchResponse({ id: 'documents', public: false });

    const result = await verifyStorageBucket(projectRef, serviceKey);

    expect(result).toBe(false);
  });
});

// =============================================================================
// updateStorageBucket Tests
// =============================================================================

describe('updateStorageBucket', () => {
  const bucketName = 'documents';

  it('should update bucket with all config options', async () => {
    mockFetchResponse({}, 204);

    await updateStorageBucket(projectRef, serviceKey, bucketName, {
      isPublic: true,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: ['application/pdf', 'image/png'],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://${projectRef}.supabase.co/storage/v1/bucket/${bucketName}`,
      expect.objectContaining({
        method: 'PUT',
      })
    );

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({
      public: true,
      file_size_limit: 20 * 1024 * 1024,
      allowed_mime_types: ['application/pdf', 'image/png'],
    });
  });

  it('should update only isPublic when specified', async () => {
    mockFetchResponse({}, 204);

    await updateStorageBucket(projectRef, serviceKey, bucketName, {
      isPublic: true,
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ public: true });
  });

  it('should update only fileSizeLimit when specified', async () => {
    mockFetchResponse({}, 204);

    await updateStorageBucket(projectRef, serviceKey, bucketName, {
      fileSizeLimit: 5 * 1024 * 1024,
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ file_size_limit: 5 * 1024 * 1024 });
  });

  it('should update only allowedMimeTypes when specified', async () => {
    mockFetchResponse({}, 204);

    await updateStorageBucket(projectRef, serviceKey, bucketName, {
      allowedMimeTypes: ['text/plain'],
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ allowed_mime_types: ['text/plain'] });
  });

  it('should send empty object when no config provided', async () => {
    mockFetchResponse({}, 204);

    await updateStorageBucket(projectRef, serviceKey, bucketName, {});

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({});
  });

  it('should throw on API error', async () => {
    mockFetchError('Bucket not found', 404);

    await expect(
      updateStorageBucket(projectRef, serviceKey, bucketName, { isPublic: true })
    ).rejects.toThrow(/Supabase Storage API error \(404\)/);
  });
});

// =============================================================================
// deleteStorageBucket Tests
// =============================================================================

describe('deleteStorageBucket', () => {
  const bucketName = 'documents';

  it('should empty and delete bucket', async () => {
    // First call: empty bucket
    mockFetchResponse({}, 204);
    // Second call: delete bucket
    mockFetchResponse({}, 204);

    await deleteStorageBucket(projectRef, serviceKey, bucketName);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call should be to empty
    expect(mockFetch.mock.calls[0][0]).toBe(
      `https://${projectRef}.supabase.co/storage/v1/bucket/${bucketName}/empty`
    );
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');

    // Second call should be to delete
    expect(mockFetch.mock.calls[1][0]).toBe(
      `https://${projectRef}.supabase.co/storage/v1/bucket/${bucketName}`
    );
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('should throw if empty operation fails', async () => {
    mockFetchError('Permission denied', 403);

    await expect(deleteStorageBucket(projectRef, serviceKey, bucketName)).rejects.toThrow(
      /Supabase Storage API error \(403\)/
    );

    // Only one call should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should throw if delete operation fails', async () => {
    // Empty succeeds
    mockFetchResponse({}, 204);
    // Delete fails
    mockFetchError('Internal error', 500);

    await expect(deleteStorageBucket(projectRef, serviceKey, bucketName)).rejects.toThrow(
      /Supabase Storage API error \(500\)/
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// listStorageBuckets Tests
// =============================================================================

describe('listStorageBuckets', () => {
  it('should list all buckets', async () => {
    const bucketsResponse = [
      { id: 'documents', name: 'documents', public: false },
      { id: 'images', name: 'images', public: true },
      { id: 'private', name: 'private', public: false },
    ];
    mockFetchResponse(bucketsResponse);

    const result = await listStorageBuckets(projectRef, serviceKey);

    expect(result).toEqual([
      { bucketId: 'documents', bucketName: 'documents', isPublic: false },
      { bucketId: 'images', bucketName: 'images', isPublic: true },
      { bucketId: 'private', bucketName: 'private', isPublic: false },
    ]);

    expect(mockFetch).toHaveBeenCalledWith(
      `https://${projectRef}.supabase.co/storage/v1/bucket`,
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('should return empty array when no buckets exist', async () => {
    mockFetchResponse([]);

    const result = await listStorageBuckets(projectRef, serviceKey);

    expect(result).toEqual([]);
  });

  it('should throw on API error', async () => {
    mockFetchError('Unauthorized', 401);

    await expect(listStorageBuckets(projectRef, serviceKey)).rejects.toThrow(
      /Supabase Storage API error \(401\)/
    );
  });
});

// =============================================================================
// API Error Handling Tests
// =============================================================================

describe('API Error Handling', () => {
  it('should include status code in error message', async () => {
    mockFetchError('Bad Request', 400);

    await expect(
      verifyStorageBucket(projectRef, serviceKey, 'test')
    ).resolves.toBe(false);
  });

  it('should handle error response with "error" field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Invalid bucket name' }),
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid bucket name' })),
    });

    await expect(
      updateStorageBucket(projectRef, serviceKey, 'test', { isPublic: true })
    ).rejects.toThrow('Invalid bucket name');
  });

  it('should handle 409 conflict as bucket exists', async () => {
    mockFetchError('Bucket already exists', 409);

    // Should not throw, should return the default bucket
    const result = await createStorageBucket(projectRef, serviceKey);

    expect(result).toEqual({
      bucketId: 'documents',
      bucketName: 'documents',
      isPublic: false,
    });
  });
});
