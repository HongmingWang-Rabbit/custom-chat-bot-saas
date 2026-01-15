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

---

### Companies API

#### `GET /api/companies`

List all companies.

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "acme-corp",
      "name": "Acme Corporation",
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### `GET /api/companies/[slug]`

Get company details including branding.

**Response:**
```json
{
  "id": "uuid",
  "slug": "acme-corp",
  "name": "Acme Corporation",
  "branding": {
    "primaryColor": "#3B82F6",
    "secondaryColor": "#1E40AF",
    "backgroundColor": "#FFFFFF",
    "textColor": "#1F2937",
    "accentColor": "#10B981",
    "fontFamily": "Inter, sans-serif",
    "borderRadius": "8px",
    "logoUrl": "/uploads/acme-logo.png",
    "customCss": null
  },
  "llm_config": {
    "provider": "openai",
    "model": "gpt-4o",
    "embeddingModel": "text-embedding-3-small",
    "temperature": 0.3,
    "maxTokens": 1000
  },
  "rag_config": {
    "topK": 5,
    "confidenceThreshold": 0.6,
    "chunkSize": 500,
    "chunkOverlap": 50
  }
}
```

#### `POST /api/companies`

Create a new company.

**Request:**
```json
{
  "slug": "new-company",
  "name": "New Company Inc"
}
```

#### `PATCH /api/companies/[slug]`

Update company settings.

**Request:**
```json
{
  "name": "Updated Name",
  "branding": {
    "primaryColor": "#FF5733"
  },
  "llm_config": {
    "model": "gpt-4-turbo"
  }
}
```

#### `PATCH /api/companies/[slug]/branding`

Update branding with logo upload.

**Request (multipart/form-data):**
```
branding: {"primaryColor":"#FF5733",...}
logo: [file]
```

---

### Documents API

#### `GET /api/documents`

List documents for a company.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `companySlug` | string | Required - company filter |
| `status` | string | Filter by status |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "company_slug": "acme-corp",
      "title": "Annual Report 2024",
      "doc_type": "disclosure",
      "status": "ready",
      "chunk_count": 45,
      "created_at": "2024-01-10T00:00:00Z"
    }
  ]
}
```

#### `GET /api/documents/[id]`

Get document details with chunks.

**Response:**
```json
{
  "id": "uuid",
  "title": "Annual Report 2024",
  "content": "...",
  "status": "ready",
  "chunk_count": 45,
  "chunks": [
    {
      "id": "uuid",
      "content": "Chunk content...",
      "chunk_index": 0
    }
  ]
}
```

#### `POST /api/documents/upload`

Upload and process a new document.

**Request (multipart/form-data):**
```
companySlug: acme-corp
title: Q3 Financial Report
file: [file]
docType: disclosure
```

OR for text content:

**Request (JSON):**
```json
{
  "companySlug": "acme-corp",
  "title": "FAQ Document",
  "content": "# FAQ\n\nQuestion 1...",
  "docType": "faq"
}
```

**Response:**
```json
{
  "document": {
    "id": "uuid",
    "title": "Q3 Financial Report",
    "status": "processing"
  },
  "message": "Document uploaded. Processing chunks..."
}
```

#### `DELETE /api/documents/[id]`

Delete document and all chunks.

**Response:**
```json
{
  "success": true,
  "deleted": {
    "document_id": "uuid",
    "chunks_deleted": 45
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
