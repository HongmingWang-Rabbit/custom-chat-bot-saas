# API Specification

## Overview

All API routes are implemented as Next.js Route Handlers using the App Router. Server-side Supabase client is used for database operations.

---

## Base URL

- **Development:** `http://localhost:3000/api`
- **Production:** `https://your-domain.vercel.app/api`

---

## Endpoints

### Q&A API

#### `POST /api/qa`

Main RAG endpoint for answering questions.

**Request:**
```json
{
  "companySlug": "acme-corp",
  "question": "What is the company's primary business?",
  "stream": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companySlug` | string | Yes | Company identifier |
| `question` | string | Yes | User's question (max 1000 chars) |
| `stream` | boolean | No | Enable SSE streaming (default: false) |

**Response (non-streaming):**
```json
{
  "answer": "Based on the disclosure documents, the company's primary business is...[Citation 1]",
  "citations": [
    {
      "doc_id": "uuid",
      "title": "Annual Report 2024",
      "chunk_id": "uuid",
      "snippet": "Our primary business focuses on...",
      "score": 0.87,
      "chunk_index": 3
    }
  ],
  "confidence": 0.85,
  "debug": {
    "retrieval_ms": 45,
    "llm_ms": 890,
    "total_ms": 950,
    "model": "gpt-4o",
    "chunks_retrieved": 5,
    "prompt_tokens": 1250,
    "completion_tokens": 280
  }
}
```

**Response (streaming - SSE):**

Content-Type: `text/event-stream`

```
data: {"type":"token","data":"Based on"}

data: {"type":"token","data":" the disclosure"}

data: {"type":"token","data":" documents..."}

data: {"type":"citation","data":{"doc_id":"uuid","title":"Annual Report","chunk_id":"uuid","snippet":"...","score":0.87,"chunk_index":3}}

data: {"type":"done","data":{"answer":"...","citations":[...],"confidence":0.85,"debug":{...}}}
```

**Event Types:**
| Type | Data | Description |
|------|------|-------------|
| `token` | string | Incremental answer text |
| `citation` | Citation object | Citation reference |
| `done` | Full response | Final complete response |
| `error` | string | Error message |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid request | Validation failed |
| 404 | Company not found | Invalid company slug |
| 500 | Internal server error | Processing failed |

**Low Confidence Fallback:**

When retrieval scores are below threshold:
```json
{
  "answer": "I don't have enough information in the provided disclosures to answer that question.",
  "citations": [],
  "confidence": 0,
  "debug": {...}
}
```

---

### Q&A Logs API

#### `GET /api/qa-logs`

Retrieve Q&A log entries for admin review.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `companySlug` | string | - | Filter by company |
| `flagged` | boolean | - | Filter flagged only |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |
| `sortBy` | string | created_at | Sort field |
| `sortOrder` | string | desc | asc or desc |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "company_slug": "acme-corp",
      "question": "What is the revenue?",
      "answer": "According to...",
      "citations": [...],
      "confidence": 0.82,
      "flagged": false,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### `PATCH /api/qa-logs/[id]/flag`

Flag or unflag a Q&A log entry.

**Request:**
```json
{
  "flagged": true,
  "reason": "Answer seems incorrect"
}
```

**Response:**
```json
{
  "id": "uuid",
  "flagged": true,
  "flagged_at": "2024-01-15T11:00:00Z",
  "flagged_reason": "Answer seems incorrect"
}
```

#### `POST /api/qa-logs/analyze`

AI-powered analysis of Q&A logs to identify patterns, user concerns, and logs needing attention.

**Request:**
```json
{
  "tenantSlug": "acme-corp",
  "logs": [
    {
      "id": "uuid",
      "question": "What is the revenue?",
      "answer": "According to...",
      "confidence": 0.85,
      "flagged": false
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tenantSlug` | string | Yes | Tenant identifier |
| `logs` | array | Yes | Array of logs to analyze (1-100 items) |

**Response:**
```json
{
  "summary": {
    "topTopics": ["revenue", "stock price", "dividends"],
    "userConcerns": ["Financial performance clarity", "Investment risks"],
    "attentionNeeded": [
      {
        "logId": "uuid",
        "reason": "Low confidence answer about executive compensation",
        "priority": "high"
      }
    ],
    "overallInsights": "Users are primarily interested in financial metrics. Consider adding more documentation about Q3 performance."
  },
  "stats": {
    "totalAnalyzed": 25,
    "avgConfidence": 0.72,
    "lowConfidenceCount": 5,
    "flaggedCount": 2
  },
  "tokensUsed": 1234
}
```

**Priority Levels:**
| Priority | Criteria |
|----------|----------|
| `high` | Confidence <30%, user flagged, incomplete answer |
| `medium` | Confidence 30-50%, topic gaps |
| `low` | Minor issues, potential improvements |

---

### Tenants API

#### `GET /api/tenants`

List all tenants.

**Response:**
```json
{
  "tenants": [
    {
      "id": "uuid",
      "slug": "acme-corp",
      "name": "Acme Corporation",
      "databaseHost": "aws-1-us-east-1.***.supabase.com",
      "status": "active",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### `GET /api/tenants/[slug]`

Get tenant details. Supports polling for provisioning status.

**Response:**
```json
{
  "tenant": {
    "id": "uuid",
    "slug": "acme-corp",
    "name": "Acme Corporation",
    "databaseHost": "aws-1-us-east-1.***.supabase.com",
    "branding": {
      "primaryColor": "#3B82F6",
      "secondaryColor": "#1E40AF",
      "backgroundColor": "#FFFFFF",
      "textColor": "#1F2937",
      "accentColor": "#10B981",
      "fontFamily": "Inter, sans-serif",
      "borderRadius": "8px",
      "logoUrl": null,
      "customCss": null
    },
    "llmProvider": "openai",
    "ragConfig": {
      "topK": 5,
      "confidenceThreshold": 0.6,
      "chunkSize": 500,
      "chunkOverlap": 50
    },
    "status": "active",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  },
  "ready": true
}
```

**Status Values:**
| Status | Description |
|--------|-------------|
| `provisioning` | Supabase project created, migrations running |
| `active` | Ready for use |
| `suspended` | Temporarily disabled |
| `error` | Provisioning failed |
| `deleted` | Soft deleted |

#### `POST /api/tenants`

Create a tenant with manual credentials.

**Request:**
```json
{
  "slug": "new-tenant",
  "name": "New Tenant Inc",
  "databaseUrl": "postgresql://...",
  "serviceKey": "service-key",
  "anonKey": "anon-key",
  "llmApiKey": "sk-..."
}
```

#### `POST /api/tenants/provision`

Auto-provision a new tenant with Supabase project.

**Request:**
```json
{
  "slug": "auto-tenant",
  "name": "Auto Tenant Inc",
  "region": "us-east-1",
  "branding": { "primaryColor": "#FF5733" },
  "ragConfig": { "topK": 10 }
}
```

**Response (HTTP 202 Accepted):**
```json
{
  "tenant": {
    "id": "uuid",
    "slug": "auto-tenant",
    "name": "Auto Tenant Inc",
    "status": "provisioning",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "supabase": {
    "projectRef": "abc123xyz",
    "apiUrl": "https://abc123xyz.supabase.co",
    "storageBucket": "documents",
    "region": "us-east-1"
  },
  "features": {
    "database": true,
    "storage": true,
    "cdn": true
  },
  "message": "Tenant created. Database migrations running in background. Poll GET /api/tenants/{slug} to check status."
}
```

#### `PATCH /api/tenants/[slug]`

Update tenant settings.

**Request:**
```json
{
  "name": "Updated Name",
  "branding": { "primaryColor": "#FF5733" },
  "ragConfig": { "topK": 10 },
  "status": "suspended"
}
```

#### `DELETE /api/tenants/[slug]`

Soft delete tenant (set status to 'deleted').

**Response:**
```json
{
  "success": true,
  "message": "Tenant deleted (soft delete)",
  "note": "Use ?hard=true to permanently delete the tenant and Supabase project"
}
```

#### `DELETE /api/tenants/[slug]?hard=true`

**IRREVERSIBLE** - Permanently delete tenant AND Supabase project (database + storage).

**Response:**
```json
{
  "success": true,
  "message": "Tenant permanently deleted",
  "deleted": {
    "tenant": true,
    "supabaseProject": true,
    "projectRef": "abc123xyz"
  }
}
```

---

### Documents API

#### `POST /api/documents/upload`

Upload and process a new document. Supports PDF, DOCX, TXT, MD files up to 10MB.

**Request (multipart/form-data):**
```
tenantSlug: acme-corp
title: Q3 Financial Report (optional)
file: [file]
docType: disclosure | faq | report | filing | other
url: https://source-url.com (optional)
```

**Response (HTTP 201):**
```json
{
  "document": {
    "id": "uuid",
    "title": "Q3 Financial Report",
    "fileName": "q3-report.pdf",
    "fileSize": 1234567,
    "status": "ready",
    "chunkCount": 45,
    "hasOriginalFile": true,
    "createdAt": "2024-01-10T00:00:00Z"
  },
  "metadata": {
    "pages": 12,
    "wordCount": 5000
  },
  "debug": {
    "traceId": "uuid",
    "parse_ms": 150,
    "chunking_ms": 50,
    "embedding_ms": 800,
    "total_ms": 1200
  }
}
```

**Supported File Types:**
| Extension | MIME Type |
|-----------|-----------|
| `.pdf` | application/pdf |
| `.docx` | application/vnd.openxmlformats-officedocument.wordprocessingml.document |
| `.txt` | text/plain |
| `.md` | text/markdown |

#### `GET /api/documents/[id]/download`

Get signed URL for downloading original file.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `tenantSlug` | string | Required - tenant identifier |

**Response:**
```json
{
  "document": {
    "id": "uuid",
    "fileName": "annual-report.pdf",
    "mimeType": "application/pdf",
    "fileSize": 1234567
  },
  "download": {
    "url": "https://xyz.supabase.co/storage/v1/object/sign/documents/...",
    "expiresAt": "2024-01-15T11:00:00Z"
  }
}
```

**Error (no original file):**
```json
{
  "error": "Original file not available",
  "code": "NO_ORIGINAL_FILE"
}
```

#### `DELETE /api/documents/[id]`

Delete document, chunks, and original file from storage.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `tenantSlug` | string | Required - tenant identifier |

**Response:**
```json
{
  "success": true,
  "deleted": {
    "document_id": "uuid",
    "chunks_deleted": 45,
    "storage_deleted": true
  }
}
```

---

### Health Check

#### `GET /api/health`

System health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "services": {
    "database": "connected",
    "openai": "configured"
  }
}
```

---

## Error Response Format

All errors follow this format:

```json
{
  "error": "Error message",
  "details": {
    "field": "Specific validation error"
  },
  "code": "ERROR_CODE"
}
```

**Common Error Codes:**
| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request validation failed |
| `NOT_FOUND` | Resource not found |
| `UNAUTHORIZED` | Authentication required |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Server error |

---

## Rate Limiting (Future)

Rate limits per company (to be implemented):

| Endpoint | Limit |
|----------|-------|
| `POST /api/qa` | 100/hour |
| `GET /api/qa-logs` | 1000/hour |
| `POST /api/documents/upload` | 50/hour |

---

## Validation Schemas (Zod)

```typescript
// POST /api/qa
const qaRequestSchema = z.object({
  companySlug: z.string().min(1).max(100),
  question: z.string().min(1).max(1000),
  stream: z.boolean().optional().default(false),
});

// PATCH /api/qa-logs/[id]/flag
const flagRequestSchema = z.object({
  flagged: z.boolean(),
  reason: z.string().max(500).optional(),
});

// POST /api/companies
const createCompanySchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(255),
});

// PATCH /api/companies/[slug]
const updateCompanySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  branding: z.record(z.unknown()).optional(),
  llm_config: z.record(z.unknown()).optional(),
  rag_config: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});
```
