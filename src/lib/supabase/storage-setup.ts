/**
 * Supabase Storage Setup
 *
 * Creates and configures storage buckets for tenant projects.
 * Called during tenant provisioning to set up file storage.
 *
 * Uses the Supabase Management API with SUPABASE_ACCESS_TOKEN for bucket creation
 * (bypasses RLS issues on newly created projects).
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

const SUPABASE_API_BASE = 'https://api.supabase.com/v1';

/**
 * Make an authenticated request to the Supabase Management API.
 * Uses SUPABASE_ACCESS_TOKEN for authentication.
 */
async function managementApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required for storage bucket creation');
  }

  const url = `${SUPABASE_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
      `Supabase Management API error (${response.status}): ${errorMessage}`
    );
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Make an authenticated request to the Supabase Storage API.
 * Uses the service_role key for authentication.
 * Used for operations after bucket is created (upload, list, etc.).
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

/** Maximum retries for storage bucket creation */
const STORAGE_MAX_RETRIES = 15;

/** Initial delay between retries (ms) - starts at 5s, increases per attempt */
const STORAGE_INITIAL_DELAY = 5000;

/**
 * Create a storage bucket for a tenant's project using the Storage API.
 * Uses service_role key for authentication.
 * Includes retry logic since storage service may not be ready immediately after project creation.
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

  // If no service key provided, skip bucket creation
  if (!serviceKey) {
    console.log(`[Storage] No service key provided, skipping bucket creation for ${projectRef}`);
    return {
      bucketId: bucketName,
      bucketName: bucketName,
      isPublic: isPublic,
    };
  }

  console.log(`[Storage] Creating bucket '${bucketName}' for project ${projectRef}`);

  // Retry logic for storage service initialization
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= STORAGE_MAX_RETRIES; attempt++) {
    try {
      // Use Storage API with service_role key
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
        bucketId: bucket.name || bucketName,
        bucketName: bucket.name || bucketName,
        isPublic: bucket.public ?? isPublic,
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

      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a transient error that may resolve with time
      const isTransientError =
        lastError.message.includes('Missing tenant config') ||
        lastError.message.includes('tenant not found') ||
        lastError.message.includes('not initialized') ||
        lastError.message.includes('row-level security policy') ||
        lastError.message.includes('violates row-level security');

      if (isTransientError && attempt < STORAGE_MAX_RETRIES) {
        const delay = STORAGE_INITIAL_DELAY * attempt;
        console.log(`[Storage] Storage service not ready (attempt ${attempt}/${STORAGE_MAX_RETRIES}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error('Storage bucket creation failed after retries');
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
