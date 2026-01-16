/**
 * Supabase Project Provisioning
 *
 * Automates creation of Supabase projects for new tenants using the
 * Supabase Management API.
 *
 * Features:
 * - Creates new Supabase projects
 * - Polls for project readiness
 * - Retrieves API keys and connection strings
 * - Runs tenant schema migrations
 */

import crypto from 'crypto';
import { createStorageBucket, DEFAULT_BUCKET_NAME } from './storage-setup';

// =============================================================================
// Configuration
// =============================================================================

const SUPABASE_API_BASE = 'https://api.supabase.com/v1';
const DEFAULT_REGION = 'us-east-1';
const PROJECT_PLAN = 'free'; // or 'pro' for paid plans

// Polling configuration
const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max wait

// =============================================================================
// Types
// =============================================================================

export interface SupabaseCredentials {
  projectRef: string;
  databaseUrl: string;           // Pooler URL (for production use)
  directDatabaseUrl: string;     // Direct URL (for migrations/setup)
  serviceKey: string;
  anonKey: string;
  apiUrl: string;
  storageBucketName: string;
}

export interface ProjectStatus {
  id: string;
  ref: string;
  name: string;
  status: 'ACTIVE_HEALTHY' | 'COMING_UP' | 'INACTIVE' | 'PAUSED' | string;
  region: string;
  createdAt: string;
}

interface ApiKey {
  name: string;
  api_key: string;
}

interface CreateProjectResponse {
  id: string;
  ref: string;
  name: string;
  status: string;
  region: string;
  created_at: string;
}

// =============================================================================
// Environment Validation
// =============================================================================

/**
 * Validate that Supabase Management API credentials are configured.
 * Throws a descriptive error if not configured.
 */
export function validateProvisioningCredentials(): void {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const orgId = process.env.SUPABASE_ORG_ID;

  if (!accessToken || !orgId) {
    const missing: string[] = [];
    if (!accessToken) missing.push('SUPABASE_ACCESS_TOKEN');
    if (!orgId) missing.push('SUPABASE_ORG_ID');

    const error = new Error(
      `Supabase Management API credentials not configured. ` +
        `Missing: ${missing.join(', ')}. ` +
        `Set these environment variables to enable automatic tenant provisioning. ` +
        `Get access token from: https://supabase.com/dashboard/account/tokens`
    );

    console.error('[Provisioning] FATAL:', error.message);
    throw error;
  }
}

/**
 * Check if provisioning credentials are configured (without throwing).
 */
export function isProvisioningConfigured(): boolean {
  return !!(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_ORG_ID);
}

// =============================================================================
// API Helpers
// =============================================================================

/**
 * Make an authenticated request to the Supabase Management API.
 */
async function supabaseApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  const response = await fetch(`${SUPABASE_API_BASE}${endpoint}`, {
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

    // Handle specific error cases
    if (response.status === 401) {
      throw new Error(
        `Supabase API authentication failed. Check your SUPABASE_ACCESS_TOKEN.`
      );
    }
    if (response.status === 403) {
      throw new Error(
        `Supabase API access denied. Ensure your access token has the required permissions.`
      );
    }
    if (response.status === 429) {
      throw new Error(
        `Supabase API rate limit exceeded. Please try again later.`
      );
    }
    if (response.status === 402) {
      throw new Error(
        `Supabase organization quota exceeded. Upgrade your plan or delete unused projects.`
      );
    }

    throw new Error(
      `Supabase API error (${response.status}): ${errorMessage}`
    );
  }

  return response.json();
}

/**
 * Generate a secure random password for the database.
 */
export function generateSecurePassword(length: number = 32): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    password += chars[randomBytes[i] % chars.length];
  }

  return password;
}

// =============================================================================
// Provisioning Functions
// =============================================================================

/**
 * List all projects in the organization.
 */
async function listProjects(): Promise<ProjectStatus[]> {
  return supabaseApi<ProjectStatus[]>('/projects');
}

/**
 * Find an existing project by name.
 */
async function findProjectByName(name: string): Promise<ProjectStatus | null> {
  const projects = await listProjects();
  return projects.find((p) => p.name === name) || null;
}

/**
 * Delete a project by reference.
 * Used to clean up orphaned projects before recreation.
 */
async function deleteProjectByRef(projectRef: string): Promise<void> {
  console.log(`[Provisioning] Deleting orphaned project ${projectRef}...`);

  await supabaseApi(`/projects/${projectRef}`, {
    method: 'DELETE',
  });

  // Wait a bit for deletion to propagate
  console.log(`[Provisioning] Waiting for project deletion to complete...`);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log(`[Provisioning] Project ${projectRef} deleted successfully`);
}

/**
 * Create a new Supabase project for a tenant.
 * If the project already exists (orphaned from failed attempt), deletes it and recreates.
 */
async function createProject(
  tenantSlug: string,
  dbPassword: string,
  region?: string
): Promise<CreateProjectResponse> {
  const orgId = process.env.SUPABASE_ORG_ID;
  const projectRegion =
    region || process.env.SUPABASE_DEFAULT_REGION || DEFAULT_REGION;
  const projectName = `tenant-${tenantSlug}`;

  console.log(`[Provisioning] Creating project for tenant: ${tenantSlug}`);
  console.log(`[Provisioning] Region: ${projectRegion}, Org: ${orgId}`);

  try {
    const response = await supabaseApi<CreateProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: projectName,
        organization_id: orgId,
        region: projectRegion,
        plan: PROJECT_PLAN,
        db_pass: dbPassword,
      }),
    });

    console.log(`[Provisioning] Project created: ${response.ref}`);

    return response;
  } catch (error) {
    // Check if project already exists
    if (
      error instanceof Error &&
      error.message.includes('already exists')
    ) {
      console.log(`[Provisioning] Project ${projectName} already exists, checking status...`);

      const existingProject = await findProjectByName(projectName);
      if (!existingProject) {
        throw new Error(
          `Project ${projectName} exists but could not be found. ` +
          `Please check Supabase dashboard and delete orphaned projects manually.`
        );
      }

      // Check the project's current status
      const projectStatus = await getProjectStatus(existingProject.ref);
      console.log(`[Provisioning] Existing project status: ${projectStatus.status}`);

      // If project is still coming up, don't delete - tell user to wait
      if (projectStatus.status === 'COMING_UP') {
        throw new Error(
          `A Supabase project for "${tenantSlug}" is still initializing (this can take 5-10 minutes). ` +
          `Please wait a few minutes and try again. If it's been more than 15 minutes, ` +
          `delete the project "${projectName}" from the Supabase dashboard and retry.`
        );
      }

      // If project is active but we don't have it in our database, it's orphaned - delete it
      if (projectStatus.status === 'ACTIVE_HEALTHY') {
        console.log(`[Provisioning] Project is active but orphaned, cleaning up...`);
      } else {
        console.log(`[Provisioning] Project in state ${projectStatus.status}, cleaning up...`);
      }

      // Delete the orphaned project
      await deleteProjectByRef(existingProject.ref);

      // Retry creation
      console.log(`[Provisioning] Retrying project creation after cleanup...`);
      const response = await supabaseApi<CreateProjectResponse>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projectName,
          organization_id: orgId,
          region: projectRegion,
          plan: PROJECT_PLAN,
          db_pass: dbPassword,
        }),
      });

      console.log(`[Provisioning] Project created after cleanup: ${response.ref}`);

      return response;
    }

    throw error;
  }
}

/**
 * Get the status of a Supabase project.
 */
async function getProjectStatus(projectRef: string): Promise<ProjectStatus> {
  return supabaseApi<ProjectStatus>(`/projects/${projectRef}`);
}

/**
 * Get API keys for a Supabase project.
 */
async function getProjectApiKeys(
  projectRef: string
): Promise<{ anonKey: string; serviceKey: string }> {
  const keys = await supabaseApi<ApiKey[]>(`/projects/${projectRef}/api-keys`);

  const anonKey = keys.find((k) => k.name === 'anon')?.api_key;
  const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key;

  if (!anonKey || !serviceKey) {
    throw new Error(
      `Failed to retrieve API keys for project ${projectRef}. ` +
        `Found keys: ${keys.map((k) => k.name).join(', ')}`
    );
  }

  return { anonKey, serviceKey };
}

/**
 * Wait for a project to become ready.
 */
async function waitForProjectReady(projectRef: string): Promise<ProjectStatus> {
  console.log(`[Provisioning] Waiting for project ${projectRef} to be ready...`);

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const status = await getProjectStatus(projectRef);

    console.log(
      `[Provisioning] Poll ${attempt}/${MAX_POLL_ATTEMPTS}: Status = ${status.status}`
    );

    if (status.status === 'ACTIVE_HEALTHY') {
      console.log(`[Provisioning] Project ${projectRef} is ready!`);
      return status;
    }

    if (status.status === 'INACTIVE' || status.status === 'PAUSED') {
      throw new Error(
        `Project ${projectRef} entered unexpected status: ${status.status}`
      );
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Project ${projectRef} did not become ready within ${
      (MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000
    } seconds`
  );
}

interface PoolerConfig {
  db_host: string;
  db_port: number;
  db_user: string;
  db_name: string;
}

/**
 * Get the pooler configuration for a project from the Supabase API.
 * This ensures we use the correct pooler host.
 */
async function getPoolerConfig(projectRef: string): Promise<PoolerConfig> {
  const configs = await supabaseApi<PoolerConfig[]>(
    `/projects/${projectRef}/config/database/pooler`
  );

  // Find the PRIMARY database pooler config
  const primaryConfig = configs.find(
    (c: PoolerConfig & { database_type?: string }) => c.database_type === 'PRIMARY'
  );

  if (!primaryConfig) {
    throw new Error(`No pooler config found for project ${projectRef}`);
  }

  return primaryConfig;
}

/**
 * Build the pooler database connection string using actual API config.
 */
function buildPoolerDatabaseUrl(
  poolerConfig: PoolerConfig,
  dbPassword: string
): string {
  return `postgresql://${poolerConfig.db_user}:${encodeURIComponent(
    dbPassword
  )}@${poolerConfig.db_host}:${poolerConfig.db_port}/${poolerConfig.db_name}?sslmode=require`;
}

/**
 * Build the direct database connection string for a Supabase project.
 * Use for initial setup/migrations (pooler may not be ready immediately).
 */
function buildDirectDatabaseUrl(
  projectRef: string,
  dbPassword: string
): string {
  const host = `db.${projectRef}.supabase.co`;
  const port = 5432; // Direct connection port
  const database = 'postgres';
  const user = 'postgres';

  return `postgresql://${user}:${encodeURIComponent(
    dbPassword
  )}@${host}:${port}/${database}?sslmode=require`;
}

// =============================================================================
// Main Provisioning Function
// =============================================================================

/**
 * Options for provisioning recovery.
 */
export interface ProvisioningOptions {
  region?: string;
  /** Pre-generated password for recovery (skip password generation) */
  dbPassword?: string;
  /** Existing project ref for recovery (skip project creation) */
  existingProjectRef?: string;
  /** Callback when project is created (for saving project ref) */
  onProjectCreated?: (projectRef: string) => Promise<void>;
}

/**
 * Provision a new Supabase project for a tenant.
 *
 * This function:
 * 1. Validates credentials are configured
 * 2. Creates a new Supabase project (or uses existing for recovery)
 * 3. Waits for the project to be ready
 * 4. Retrieves API keys
 * 5. Returns all credentials needed for tenant creation
 *
 * @param tenantSlug - Unique identifier for the tenant
 * @param options - Provisioning options including recovery parameters
 * @returns All credentials needed to create the tenant
 */
export async function provisionSupabaseProject(
  tenantSlug: string,
  options: ProvisioningOptions = {}
): Promise<SupabaseCredentials> {
  // Validate credentials are configured
  validateProvisioningCredentials();

  const isRecovery = !!(options.dbPassword && options.existingProjectRef);
  console.log(`[Provisioning] Starting provisioning for tenant: ${tenantSlug}${isRecovery ? ' (recovery mode)' : ''}`);
  const startTime = Date.now();

  try {
    // Use provided password or generate a new one
    const dbPassword = options.dbPassword ?? generateSecurePassword(32);
    let projectRef: string;

    // Use existing project or create new one
    if (options.existingProjectRef) {
      console.log(`[Provisioning] Using existing project: ${options.existingProjectRef}`);
      projectRef = options.existingProjectRef;
    } else {
      // Create the project (handles orphaned project cleanup automatically)
      const project = await createProject(tenantSlug, dbPassword, options.region);
      projectRef = project.ref;

      // Notify caller about project creation (for saving ref)
      if (options.onProjectCreated) {
        await options.onProjectCreated(projectRef);
      }
    }

    // Wait for the project to be ready
    await waitForProjectReady(projectRef);

    // Get API keys
    const { anonKey, serviceKey } = await getProjectApiKeys(projectRef);

    // Get pooler configuration from API (critical: host varies per project!)
    console.log(`[Provisioning] Fetching pooler config for ${projectRef}...`);
    const poolerConfig = await getPoolerConfig(projectRef);
    console.log(`[Provisioning] Pooler host: ${poolerConfig.db_host}`);

    // Build the database connection strings
    // Pooler URL is for production use (connection pooling)
    const databaseUrl = buildPoolerDatabaseUrl(poolerConfig, dbPassword);
    // Direct URL is for migrations/setup (pooler may not be ready immediately)
    const directDatabaseUrl = buildDirectDatabaseUrl(projectRef, dbPassword);

    // Create storage bucket for documents
    console.log(`[Provisioning] Creating storage bucket for project ${projectRef}...`);
    const storageBucket = await createStorageBucket(projectRef, serviceKey);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Provisioning] Successfully provisioned project ${projectRef} in ${elapsed}s`
    );

    return {
      projectRef,
      databaseUrl,
      directDatabaseUrl,
      serviceKey,
      anonKey,
      apiUrl: `https://${projectRef}.supabase.co`,
      storageBucketName: storageBucket.bucketName,
    };
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(
      `[Provisioning] Failed to provision project for ${tenantSlug} after ${elapsed}s:`,
      error
    );
    throw error;
  }
}

// =============================================================================
// Project Management
// =============================================================================

/**
 * Delete a Supabase project.
 * Use with caution - this is irreversible.
 */
export async function deleteSupabaseProject(projectRef: string): Promise<void> {
  validateProvisioningCredentials();

  console.log(`[Provisioning] Deleting project: ${projectRef}`);

  await supabaseApi(`/projects/${projectRef}`, {
    method: 'DELETE',
  });

  console.log(`[Provisioning] Project ${projectRef} deleted`);
}

/**
 * Pause a Supabase project (to save resources).
 */
export async function pauseSupabaseProject(projectRef: string): Promise<void> {
  validateProvisioningCredentials();

  console.log(`[Provisioning] Pausing project: ${projectRef}`);

  await supabaseApi(`/projects/${projectRef}/pause`, {
    method: 'POST',
  });

  console.log(`[Provisioning] Project ${projectRef} paused`);
}

/**
 * Resume a paused Supabase project.
 */
export async function resumeSupabaseProject(projectRef: string): Promise<void> {
  validateProvisioningCredentials();

  console.log(`[Provisioning] Resuming project: ${projectRef}`);

  await supabaseApi(`/projects/${projectRef}/restore`, {
    method: 'POST',
  });

  console.log(`[Provisioning] Project ${projectRef} resume initiated`);
}

/**
 * List all projects in the organization.
 */
export async function listSupabaseProjects(): Promise<ProjectStatus[]> {
  validateProvisioningCredentials();

  return supabaseApi<ProjectStatus[]>('/projects');
}
