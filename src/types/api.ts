/**
 * API request and response types.
 */

import { Citation, DebugInfo, TenantBranding, RAGConfig } from './database';

// =============================================================================
// Q&A API
// =============================================================================

/**
 * Request body for POST /api/qa
 */
export interface QARequest {
  tenantSlug: string;
  question: string;
  stream?: boolean;
}

/**
 * Response from POST /api/qa (non-streaming)
 */
export interface QAResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  debug?: DebugInfo;
}

/**
 * Server-Sent Event types for streaming Q&A.
 */
export type QAStreamEventType = 'token' | 'citation' | 'done' | 'error';

export interface QAStreamEvent {
  type: QAStreamEventType;
  data: string | Citation | QAResponse | { message: string };
}

// =============================================================================
// Q&A Logs API
// =============================================================================

/**
 * Query parameters for GET /api/qa-logs
 */
export interface QALogsQuery {
  tenantSlug?: string;
  flagged?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'created_at' | 'confidence';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Request body for PATCH /api/qa-logs/[id]/flag
 */
export interface FlagRequest {
  flagged: boolean;
  reason?: string;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// =============================================================================
// Tenants API
// =============================================================================

/**
 * Request body for POST /api/tenants
 */
export interface CreateTenantRequest {
  slug: string;
  name: string;
  databaseUrl: string;
  serviceKey: string;
  anonKey: string;
  llmApiKey?: string;
  branding?: Partial<TenantBranding>;
}

/**
 * Request body for PATCH /api/tenants/[slug]
 */
export interface UpdateTenantRequest {
  name?: string;
  branding?: Partial<TenantBranding>;
  llmProvider?: string;
  ragConfig?: Partial<RAGConfig>;
  status?: string;
}

/**
 * Request body for updating tenant credentials
 */
export interface UpdateCredentialsRequest {
  databaseUrl?: string;
  serviceKey?: string;
  anonKey?: string;
  llmApiKey?: string;
}

/**
 * Public tenant info (no secrets)
 */
export interface TenantPublicInfo {
  slug: string;
  name: string;
  branding: TenantBranding;
  status: string;
}

// =============================================================================
// Documents API
// =============================================================================

/**
 * Request body for POST /api/documents/upload (JSON)
 */
export interface DocumentUploadRequest {
  tenantSlug: string;
  title: string;
  content: string;
  url?: string;
  docType?: string;
}

/**
 * Response from document upload
 */
export interface DocumentUploadResponse {
  document: {
    id: string;
    title: string;
    status: string;
  };
  chunks: {
    count: number;
    preview: string[];  // First few chunk snippets
  };
}

// =============================================================================
// Error Response
// =============================================================================

/**
 * Standard API error response
 */
export interface APIError {
  error: string;
  code?: string;
  details?: Record<string, string>;
}

/**
 * Error codes
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'LLM_ERROR';

// =============================================================================
// Health Check
// =============================================================================

/**
 * Response from GET /api/health
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    database: 'connected' | 'disconnected' | 'error';
    openai: 'configured' | 'not_configured' | 'error';
  };
}
