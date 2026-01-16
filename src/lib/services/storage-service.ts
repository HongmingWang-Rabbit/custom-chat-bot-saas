/**
 * Storage Service
 *
 * Handles file upload and download operations for tenant document storage.
 * Uses Supabase Storage via the JS client library.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_BUCKET_NAME } from '@/lib/supabase/storage-setup';

// =============================================================================
// Types
// =============================================================================

export interface StorageUploadResult {
  storageKey: string;
  size: number;
}

export interface SignedUrlResult {
  signedUrl: string;
  expiresAt: Date;
}

export interface StorageServiceConfig {
  apiUrl: string;
  serviceKey: string;
  bucketName?: string;
}

// =============================================================================
// Storage Service Class
// =============================================================================

/**
 * Storage service for a specific tenant's Supabase project.
 * Handles file uploads, downloads, and signed URL generation.
 */
export class StorageService {
  private client: SupabaseClient;
  private bucketName: string;

  constructor(config: StorageServiceConfig) {
    this.client = createClient(config.apiUrl, config.serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    this.bucketName = config.bucketName ?? DEFAULT_BUCKET_NAME;
  }

  /**
   * Upload a file to the tenant's storage bucket.
   *
   * Storage path format: {documentId}/{filename}
   * This allows multiple files per document if needed in the future.
   *
   * @param documentId - UUID of the document record
   * @param fileName - Original filename
   * @param buffer - File content as Buffer
   * @param mimeType - MIME type of the file
   * @returns Upload result with storage key and size
   */
  async uploadFile(
    documentId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StorageUploadResult> {
    // Sanitize filename for storage path
    const safeFileName = this.sanitizeFileName(fileName);
    const storageKey = `${documentId}/${safeFileName}`;

    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .upload(storageKey, buffer, {
        contentType: mimeType,
        upsert: true, // Overwrite if exists
      });

    if (error) {
      throw new StorageError(`Failed to upload file: ${error.message}`, error);
    }

    return {
      storageKey: data.path,
      size: buffer.length,
    };
  }

  /**
   * Generate a signed URL for private file access.
   *
   * @param storageKey - The storage path (e.g., "{docId}/{filename}")
   * @param expiresInSeconds - URL expiration time (default: 1 hour)
   * @returns Signed URL and expiration timestamp
   */
  async getSignedUrl(
    storageKey: string,
    expiresInSeconds: number = 3600
  ): Promise<SignedUrlResult> {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .createSignedUrl(storageKey, expiresInSeconds, {
        download: true, // Force download instead of inline display
      });

    if (error) {
      throw new StorageError(
        `Failed to create signed URL: ${error.message}`,
        error
      );
    }

    return {
      signedUrl: data.signedUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  /**
   * Download a file from storage.
   *
   * @param storageKey - The storage path
   * @returns File content as Buffer
   */
  async downloadFile(storageKey: string): Promise<Buffer> {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .download(storageKey);

    if (error) {
      throw new StorageError(`Failed to download file: ${error.message}`, error);
    }

    // Convert Blob to Buffer
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete a file from storage.
   *
   * @param storageKey - The storage path to delete
   */
  async deleteFile(storageKey: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucketName)
      .remove([storageKey]);

    if (error) {
      throw new StorageError(`Failed to delete file: ${error.message}`, error);
    }
  }

  /**
   * Delete all files for a document.
   *
   * @param documentId - UUID of the document
   */
  async deleteDocumentFiles(documentId: string): Promise<void> {
    // List all files in the document folder
    const { data: files, error: listError } = await this.client.storage
      .from(this.bucketName)
      .list(documentId);

    if (listError) {
      throw new StorageError(
        `Failed to list document files: ${listError.message}`,
        listError
      );
    }

    if (!files || files.length === 0) {
      return; // No files to delete
    }

    // Delete all files
    const paths = files.map((f) => `${documentId}/${f.name}`);
    const { error: deleteError } = await this.client.storage
      .from(this.bucketName)
      .remove(paths);

    if (deleteError) {
      throw new StorageError(
        `Failed to delete document files: ${deleteError.message}`,
        deleteError
      );
    }
  }

  /**
   * List all files for a document.
   *
   * @param documentId - UUID of the document
   * @returns Array of file names
   */
  async listDocumentFiles(documentId: string): Promise<string[]> {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .list(documentId);

    if (error) {
      throw new StorageError(
        `Failed to list document files: ${error.message}`,
        error
      );
    }

    return data?.map((f) => f.name) ?? [];
  }

  /**
   * Check if a file exists in storage.
   *
   * @param storageKey - The storage path to check
   * @returns true if file exists
   */
  async fileExists(storageKey: string): Promise<boolean> {
    try {
      // Try to get file metadata by listing the parent folder
      const parts = storageKey.split('/');
      const fileName = parts.pop();
      const folder = parts.join('/');

      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .list(folder);

      if (error) {
        return false;
      }

      return data?.some((f) => f.name === fileName) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Sanitize a filename for safe storage.
   * Removes special characters and ensures valid path component.
   */
  private sanitizeFileName(fileName: string): string {
    // Replace spaces with underscores, remove special chars except .-_
    return fileName
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .substring(0, 255); // Limit length
  }
}

// =============================================================================
// Custom Error
// =============================================================================

export class StorageError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a storage service for a tenant.
 *
 * @param apiUrl - Tenant's Supabase API URL (e.g., https://xxx.supabase.co)
 * @param serviceKey - Tenant's service role key
 * @param bucketName - Optional bucket name override
 * @returns StorageService instance
 */
export function createStorageService(
  apiUrl: string,
  serviceKey: string,
  bucketName?: string
): StorageService {
  return new StorageService({
    apiUrl,
    serviceKey,
    bucketName,
  });
}
