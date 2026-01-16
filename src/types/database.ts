/**
 * Database entity types for the multi-tenant RAG Q&A SaaS.
 *
 * Main Database: tenants table (stores encrypted credentials)
 * Tenant Databases: documents, document_chunks, qa_logs tables
 */

// =============================================================================
// Main Database Types (Tenant Metadata)
// =============================================================================

/**
 * Tenant record in main database.
 * Sensitive fields are stored encrypted (AES-256-GCM).
 */
export interface Tenant {
  id: string;
  slug: string;
  name: string;

  // Encrypted sensitive data (stored as iv:authTag:ciphertext)
  encrypted_database_url: string;
  encrypted_service_key: string | null;
  encrypted_anon_key: string | null;
  encrypted_llm_api_key: string | null;

  // Non-sensitive display/config
  database_host: string | null;  // Masked host for display
  database_region: string | null;

  // Branding configuration
  branding: TenantBranding;

  // LLM configuration
  llm_provider: LLMProvider;
  rag_config: RAGConfig;

  // Status
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Tenant with decrypted secrets.
 * Use sparingly - only when database access is needed.
 */
export interface TenantWithSecrets extends Omit<Tenant,
  | 'encrypted_database_url'
  | 'encrypted_service_key'
  | 'encrypted_anon_key'
  | 'encrypted_llm_api_key'
> {
  database_url: string;
  service_key: string;
  anon_key: string;
  llm_api_key: string | null;
}

export type TenantStatus = 'active' | 'suspended' | 'pending' | 'deleted';
export type LLMProvider = 'openai' | 'anthropic' | 'azure' | 'custom';

/**
 * Tenant branding configuration.
 * Applied via CSS custom properties at runtime.
 */
export interface TenantBranding {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: string;
  logoUrl: string | null;
  customCss: string | null;
}

/**
 * RAG configuration per tenant.
 */
export interface RAGConfig {
  topK: number;                   // Number of chunks to retrieve
  confidenceThreshold: number;    // Minimum similarity score (0.0 - 1.0)
  chunkSize: number;              // Characters per chunk
  chunkOverlap: number;           // Overlap between chunks
}

// =============================================================================
// Tenant Database Types (Per-Tenant Data)
// =============================================================================

/**
 * Document in tenant's database.
 * Source documents before chunking.
 */
export interface Document {
  id: string;
  title: string;
  content: string;
  url: string | null;

  // Metadata
  doc_type: DocumentType;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;

  // Processing status
  status: DocumentStatus;
  chunk_count: number;

  created_at: string;
  updated_at: string;
}

export type DocumentType = 'disclosure' | 'faq' | 'report' | 'filing' | 'other';
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error';

/**
 * Document chunk with vector embedding.
 */
export interface DocumentChunk {
  id: string;
  doc_id: string;
  content: string;
  embedding: number[] | null;  // 1536 dimensions for OpenAI

  // Position tracking
  chunk_index: number;
  start_char: number | null;
  end_char: number | null;
  token_count: number | null;

  // Denormalized for faster retrieval
  doc_title: string;

  created_at: string;
}

/**
 * Q&A interaction log.
 */
export interface QALog {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];

  // Quality metrics
  confidence: number;
  retrieval_scores: number[] | null;

  // Review workflow
  flagged: boolean;
  flagged_at: string | null;
  flagged_reason: string | null;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewer_notes: string | null;

  // Debug info
  debug_info: DebugInfo;

  // Request metadata
  user_agent: string | null;
  ip_address: string | null;
  session_id: string | null;

  created_at: string;
}

/**
 * Citation reference in Q&A response.
 */
export interface Citation {
  doc_id: string;
  title: string;
  chunk_id: string;
  snippet: string;
  score: number;
  chunk_index: number;
}

/**
 * Debug information for Q&A request.
 */
export interface DebugInfo {
  retrieval_ms: number;
  llm_ms: number;
  total_ms: number;
  model: string;
  chunks_retrieved: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

// =============================================================================
// Default Values
// =============================================================================

export const DEFAULT_BRANDING: TenantBranding = {
  primaryColor: '#3B82F6',
  secondaryColor: '#1E40AF',
  backgroundColor: '#FFFFFF',
  textColor: '#1F2937',
  accentColor: '#10B981',
  fontFamily: 'Inter, system-ui, sans-serif',
  borderRadius: '8px',
  logoUrl: null,
  customCss: null,
};

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  topK: 5,
  confidenceThreshold: 0.6,
  chunkSize: 500,
  chunkOverlap: 50,
};
