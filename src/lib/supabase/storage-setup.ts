/**
 * Supabase Storage Setup
 *
 * Creates and configures storage buckets for tenant projects.
 * Called during tenant provisioning to set up file storage.
 *
 * Uses the Storage API directly (not Management API) with service_role key.
 */

// =============================================================================
// Configuration
// =============================================================================

/** Default bucket name for document storage */
export const DEFAULT_BUCKET_NAME = 'documents';

/** Maximum file size in bytes (10MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Allowed MIME types for document uploads */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
];

// =============================================================================
// Types
// =============================================================================

export interface StorageBucketConfig {
  bucketName: string;
  isPublic: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

export interface StorageBucketResult {
  bucketId: string;
  bucketName: string;
  isPublic: boolean;
}

interface SupabaseBucketResponse {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Custom Errors
// =============================================================================

export class BucketExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BucketExistsError';
  }
}

// =============================================================================
// API Helpers
// =============================================================================

/**
 * Make an authenticated request to the Supabase Storage API.
 * Uses the service_role key for authentication.
 */
async function storageApi<T>(
  projectRef: string,
  serviceKey: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // Storage API URL: https://{projectRef}.supabase.co/storage/v1
  const url = `https://${projectRef}.supabase.co/storage/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage: string;

    try {
      const errorJson = JSON.parse(errorBody);
      errorMessage = errorJson.message || errorJson.error || errorBody;
    } catch {
      errorMessage = errorBody;
    }

    // Handle bucket already exists (409 Conflict)
    if (response.status === 409 || errorMessage.includes('already exists')) {
      throw new BucketExistsError(errorMessage);
    }

    throw new Error(
      `Supabase Storage API error (${response.status}): ${errorMessage}`
    );
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// =============================================================================
// Storage Setup Functions
// =============================================================================

/**
 * Create a storage bucket for a tenant's project.
 *
 * @param projectRef - Supabase project reference (e.g., 'jdxhoqdnxshzbjasfhfz')
 * @param serviceKey - Service role key for the project
 * @param config - Bucket configuration options
 * @returns Bucket creation result
 */
export async function createStorageBucket(
  projectRef: string,
  serviceKey?: string,
  config: Partial<StorageBucketConfig> = {}
): Promise<StorageBucketResult> {
  const bucketName = config.bucketName ?? DEFAULT_BUCKET_NAME;
  const isPublic = config.isPublic ?? false;
  const fileSizeLimit = config.fileSizeLimit ?? MAX_FILE_SIZE;
  const allowedMimeTypes = config.allowedMimeTypes ?? ALLOWED_MIME_TYPES;

  // If no service key provided, skip bucket creation (will be created on first upload)
  if (!serviceKey) {
    console.log(`[Storage] No service key provided, skipping bucket creation for ${projectRef}`);
    return {
      bucketId: bucketName,
      bucketName: bucketName,
      isPublic: isPublic,
    };
  }

  console.log(`[Storage] Creating bucket '${bucketName}' for project ${projectRef}`);

  try {
    const bucket = await storageApi<SupabaseBucketResponse>(
      projectRef,
      serviceKey,
      '/bucket',
      {
        method: 'POST',
        body: JSON.stringify({
          id: bucketName,
          name: bucketName,
          public: isPublic,
          file_size_limit: fileSizeLimit,
          allowed_mime_types: allowedMimeTypes,
        }),
      }
    );

    console.log(`[Storage] Bucket '${bucketName}' created successfully`);

    return {
      bucketId: bucket.name,
      bucketName: bucket.name,
      isPublic: bucket.public,
    };
  } catch (error) {
    if (error instanceof BucketExistsError) {
      console.log(`[Storage] Bucket '${bucketName}' already exists`);
      return {
        bucketId: bucketName,
        bucketName: bucketName,
        isPublic: isPublic,
      };
    }
    throw error;
  }
}

/**
 * Verify that a storage bucket exists and is accessible.
 *
 * @param projectRef - Supabase project reference
 * @param serviceKey - Service role key for the project
 * @param bucketName - Name of the bucket to verify
 * @returns true if bucket exists and is accessible
 */
export async function verifyStorageBucket(
  projectRef: string,
  serviceKey: string,
  bucketName: string = DEFAULT_BUCKET_NAME
): Promise<boolean> {
  try {
    const bucket = await storageApi<SupabaseBucketResponse>(
      projectRef,
      serviceKey,
      `/bucket/${bucketName}`,
      { method: 'GET' }
    );

    console.log(`[Storage] Bucket '${bucketName}' verified: exists=${!!bucket.name}`);
    return !!bucket.name;
  } catch (error) {
    console.log(`[Storage] Bucket '${bucketName}' verification failed:`, error);
    return false;
  }
}

/**
 * Update an existing storage bucket's configuration.
 *
 * @param projectRef - Supabase project reference
 * @param serviceKey - Service role key for the project
 * @param bucketName - Name of the bucket to update
 * @param config - New configuration options
 */
export async function updateStorageBucket(
  projectRef: string,
  serviceKey: string,
  bucketName: string,
  config: Partial<Omit<StorageBucketConfig, 'bucketName'>>
): Promise<void> {
  console.log(`[Storage] Updating bucket '${bucketName}' for project ${projectRef}`);

  const updatePayload: Record<string, unknown> = {};

  if (config.isPublic !== undefined) {
    updatePayload.public = config.isPublic;
  }
  if (config.fileSizeLimit !== undefined) {
    updatePayload.file_size_limit = config.fileSizeLimit;
  }
  if (config.allowedMimeTypes !== undefined) {
    updatePayload.allowed_mime_types = config.allowedMimeTypes;
  }

  await storageApi(projectRef, serviceKey, `/bucket/${bucketName}`, {
    method: 'PUT',
    body: JSON.stringify(updatePayload),
  });

  console.log(`[Storage] Bucket '${bucketName}' updated successfully`);
}

/**
 * Delete a storage bucket.
 * Use with caution - this will delete all files in the bucket.
 *
 * @param projectRef - Supabase project reference
 * @param serviceKey - Service role key for the project
 * @param bucketName - Name of the bucket to delete
 */
export async function deleteStorageBucket(
  projectRef: string,
  serviceKey: string,
  bucketName: string
): Promise<void> {
  console.log(`[Storage] Deleting bucket '${bucketName}' for project ${projectRef}`);

  // First, empty the bucket (required before deletion)
  await storageApi(projectRef, serviceKey, `/bucket/${bucketName}/empty`, {
    method: 'POST',
  });

  // Then delete the bucket
  await storageApi(projectRef, serviceKey, `/bucket/${bucketName}`, {
    method: 'DELETE',
  });

  console.log(`[Storage] Bucket '${bucketName}' deleted successfully`);
}

/**
 * List all storage buckets for a project.
 *
 * @param projectRef - Supabase project reference
 * @param serviceKey - Service role key for the project
 * @returns Array of bucket information
 */
export async function listStorageBuckets(
  projectRef: string,
  serviceKey: string
): Promise<StorageBucketResult[]> {
  const buckets = await storageApi<SupabaseBucketResponse[]>(
    projectRef,
    serviceKey,
    '/bucket',
    { method: 'GET' }
  );

  return buckets.map((b) => ({
    bucketId: b.id,
    bucketName: b.name,
    isPublic: b.public,
  }));
}
