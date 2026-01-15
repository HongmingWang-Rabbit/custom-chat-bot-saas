# Architecture Overview

## System Architecture

This is a multi-tenant RAG-based Q&A SaaS where **each tenant gets a dedicated database**. Sensitive credentials are stored with **AES-256-GCM encryption**.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Vercel / Next.js                                   │
│                                                                                 │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │
│  │   Public Q&A      │  │   Admin Pages     │  │      API Routes           │   │
│  │ /demo/[tenant]    │  │ /admin/review     │  │ /api/qa          (RAG)    │   │
│  │                   │  │ /admin/tenants    │  │ /api/tenants     (CRUD)   │   │
│  │ - Question input  │  │ /admin/documents  │  │ /api/documents   (Upload) │   │
│  │ - SSE streaming   │  │                   │  │ /api/qa-logs     (Logs)   │   │
│  │ - Citations       │  │ - Q&A logs review │  │                           │   │
│  │ - Tenant branding │  │ - Tenant settings │  │ - Request tracing         │   │
│  └───────────────────┘  │ - Doc management  │  │ - Pino logging            │   │
│           │             └───────────────────┘  └───────────────────────────┘   │
│           │                       │                        │                    │
│           └───────────────────────┴────────────────────────┘                    │
│                                   │                                             │
│                                   ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                          Service Layer                                    │  │
│  │                                                                           │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │  │
│  │  │  TenantService  │  │   RAG Engine    │  │     LLM Adapter         │   │  │
│  │  │                 │  │                 │  │                         │   │  │
│  │  │ - Connection    │  │ - Retrieval     │  │ - OpenAI (default)      │   │  │
│  │  │   pooling       │  │ - Chunking      │  │ - Anthropic (adapter)   │   │  │
│  │  │ - Credential    │  │ - Embeddings    │  │ - Azure (adapter)       │   │  │
│  │  │   decryption    │  │ - Citations     │  │ - Factory pattern       │   │  │
│  │  │ - DB routing    │  │ - Confidence    │  │                         │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘   │  │
│  │                                                                           │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │  │
│  │  │    Logging      │  │    Crypto       │  │     Parsers             │   │  │
│  │  │                 │  │                 │  │                         │   │  │
│  │  │ - Pino logger   │  │ - AES-256-GCM   │  │ - PDF (pdf-parse)       │   │  │
│  │  │ - Request trace │  │ - Encrypt/      │  │ - DOCX (mammoth)        │   │  │
│  │  │ - Sanitization  │  │   Decrypt       │  │ - TXT, MD               │   │  │
│  │  │ - Timer utils   │  │ - Key rotation  │  │                         │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘   │  │
│  │                                                                           │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                             │
└───────────────────────────────────┼─────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│   Main Database   │    │  Tenant Databases │    │     OpenAI API    │
│   (PostgreSQL)    │    │  (PostgreSQL +    │    │                   │
│                   │    │   pgvector)       │    │ - GPT-4o          │
│ tenants table:    │    │                   │    │ - text-embedding  │
│ - slug, name      │    │ Per-tenant:       │    │   -3-small        │
│ - encrypted_db_url│    │ - documents       │    │                   │
│ - encrypted_keys  │    │ - document_chunks │    │                   │
│ - branding        │    │ - qa_logs         │    │                   │
│ - rag_config      │    │ - settings        │    │                   │
└───────────────────┘    └───────────────────┘    └───────────────────┘
```

---

## Multi-Tenant Architecture

### Dedicated Database Per Tenant

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Main Database (DATABASE_URL)                            │
│                                                                                 │
│   tenants table:                                                                │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │ slug      │ name       │ encrypted_database_url    │ encrypted_llm_key │  │
│   │───────────│────────────│───────────────────────────│───────────────────│  │
│   │ acme-corp │ Acme Corp  │ iv:tag:encrypted_url...   │ iv:tag:enc_key... │  │
│   │ beta-inc  │ Beta Inc   │ iv:tag:encrypted_url...   │ iv:tag:enc_key... │  │
│   │ demo-co   │ Demo Co    │ iv:tag:encrypted_url...   │ iv:tag:enc_key... │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│                    decrypt with MASTER_KEY                                      │
│                              │                                                  │
│            ┌─────────────────┼─────────────────┐                               │
│            ▼                 ▼                 ▼                               │
│   ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                     │
│   │  Acme Corp DB  │ │  Beta Inc DB   │ │   Demo Co DB   │                     │
│   │                │ │                │ │                │                     │
│   │  - documents   │ │  - documents   │ │  - documents   │                     │
│   │  - chunks      │ │  - chunks      │ │  - chunks      │                     │
│   │  - qa_logs     │ │  - qa_logs     │ │  - qa_logs     │                     │
│   │  - settings    │ │  - settings    │ │  - settings    │                     │
│   └────────────────┘ └────────────────┘ └────────────────┘                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Why Dedicated Databases?

| Aspect | Single DB (Row-Level) | Dedicated DBs (Current) |
|--------|----------------------|-------------------------|
| **Data Isolation** | Logical (slug filter) | Physical (complete) |
| **Security** | Shared schema | Complete separation |
| **Compliance** | May not meet requirements | GDPR/SOC2 friendly |
| **Performance** | Shared resources | Per-tenant scaling |
| **Backup/Restore** | Complex | Per-tenant backups |
| **Cost** | Lower | Higher |

---

## Request Flow: Q&A Query

```
┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│  User    │    │   Next.js   │    │  Tenant     │    │   OpenAI    │    │   Tenant     │
│          │    │  API Route  │    │  Service    │    │             │    │   Database   │
└────┬─────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬───────┘
     │                 │                   │                  │                  │
     │ POST /api/qa    │                   │                  │                  │
     │ {question,      │                   │                  │                  │
     │  tenantSlug}    │                   │                  │                  │
     │────────────────►│                   │                  │                  │
     │                 │                   │                  │                  │
     │                 │  getTenantDb()    │                  │                  │
     │                 │  (decrypt creds)  │                  │                  │
     │                 │──────────────────►│                  │                  │
     │                 │◄──────────────────│                  │                  │
     │                 │   TenantDatabase  │                  │                  │
     │                 │                   │                  │                  │
     │                 │  Embed question   │                  │                  │
     │                 │──────────────────────────────────────►│                  │
     │                 │◄──────────────────────────────────────│                  │
     │                 │   [embedding]     │                  │                  │
     │                 │                   │                  │                  │
     │                 │  Vector search (match_documents)     │                  │
     │                 │─────────────────────────────────────────────────────────►│
     │                 │◄─────────────────────────────────────────────────────────│
     │                 │   [relevant chunks]                  │                  │
     │                 │                   │                  │                  │
     │                 │  Generate answer (stream)            │                  │
     │                 │──────────────────────────────────────►│                  │
     │                 │                   │                  │                  │
     │  SSE: chunk     │◄──────────────────────────────────────│                  │
     │◄────────────────│                   │                  │                  │
     │  SSE: chunk     │◄──────────────────────────────────────│                  │
     │◄────────────────│  ...              │                  │                  │
     │                 │                   │                  │                  │
     │  SSE: citations │                   │                  │                  │
     │◄────────────────│                   │                  │                  │
     │  SSE: complete  │                   │                  │                  │
     │◄────────────────│                   │                  │                  │
     │                 │                   │                  │                  │
     │                 │  Log to qa_logs   │                  │                  │
     │                 │─────────────────────────────────────────────────────────►│
     │                 │                   │                  │                  │
```

---

## Directory Structure

```
custom-chat-bot-saas/
├── docs/
│   ├── architecture/           # Architecture documentation
│   │   ├── 01-architecture-overview.md
│   │   ├── 02-database-schema.md
│   │   └── 03-multi-tenant-encryption.md
│   ├── edit-history/           # Session changelogs
│   └── README.md
│
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   │
│   │   ├── demo/
│   │   │   └── [tenantSlug]/
│   │   │       ├── page.tsx              # Public Q&A (SSR)
│   │   │       └── DemoPageClient.tsx    # Client component
│   │   │
│   │   ├── admin/
│   │   │   ├── layout.tsx                # Admin sidebar
│   │   │   ├── page.tsx                  # Dashboard
│   │   │   ├── review/page.tsx           # Q&A logs review
│   │   │   ├── tenants/
│   │   │   │   ├── page.tsx              # Tenant list
│   │   │   │   └── [slug]/page.tsx       # Tenant settings
│   │   │   └── documents/page.tsx        # Doc management
│   │   │
│   │   └── api/
│   │       ├── qa/route.ts               # RAG endpoint (SSE)
│   │       ├── qa-logs/
│   │       │   ├── route.ts              # GET logs
│   │       │   └── [id]/route.ts         # Flag/review
│   │       ├── tenants/
│   │       │   ├── route.ts              # GET/POST
│   │       │   └── [slug]/route.ts       # GET/PUT/DELETE
│   │       └── documents/
│   │           ├── route.ts              # GET/DELETE
│   │           └── upload/route.ts       # POST upload
│   │
│   ├── components/
│   │   ├── ui/                           # shadcn/ui base
│   │   └── features/
│   │       └── qa/                       # Q&A components
│   │           ├── ChatContainer.tsx
│   │           ├── ChatMessage.tsx
│   │           ├── ChatInput.tsx
│   │           └── Citation.tsx
│   │
│   ├── db/
│   │   ├── client.ts                     # Drizzle clients
│   │   ├── index.ts                      # Exports
│   │   └── schema/
│   │       ├── main.ts                   # tenants table
│   │       └── tenant.ts                 # documents, chunks, logs
│   │
│   ├── hooks/
│   │   └── useChat.ts                    # SSE chat hook
│   │
│   ├── lib/
│   │   ├── logger.ts                     # Pino logging
│   │   ├── middleware.ts                 # Request middleware
│   │   │
│   │   ├── crypto/
│   │   │   └── encryption.ts             # AES-256-GCM
│   │   │
│   │   ├── services/
│   │   │   └── tenant-service.ts         # Tenant DB routing
│   │   │
│   │   ├── llm/
│   │   │   ├── adapter.ts                # LLM interface
│   │   │   ├── openai-adapter.ts         # OpenAI impl
│   │   │   ├── factory.ts                # Adapter factory
│   │   │   ├── prompts.ts                # Prompt templates
│   │   │   └── sanitize.ts               # Input sanitization
│   │   │
│   │   ├── rag/
│   │   │   ├── service.ts                # RAG orchestrator
│   │   │   ├── retrieval.ts              # Vector search
│   │   │   ├── embeddings.ts             # Embedding gen
│   │   │   ├── chunker.ts                # Doc chunking
│   │   │   └── citations.ts              # Citation mapping
│   │   │
│   │   ├── parsers/
│   │   │   └── file-parser.ts            # PDF, DOCX, TXT
│   │   │
│   │   └── supabase/
│   │       ├── main-client.ts            # Main DB client
│   │       ├── provisioning.ts           # Supabase project API
│   │       └── tenant-migrations.ts      # Schema migrations
│   │
│   └── types/
│       ├── api.ts
│       ├── database.ts
│       └── llm.ts
│
├── drizzle.config.ts                     # Main DB config
├── drizzle.tenant.config.ts              # Tenant DB config
├── package.json
└── .env.example
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Next.js 14+ (App Router) | RSC, API routes, streaming |
| ORM | Drizzle ORM | Type-safe SQL, migrations |
| Main Database | PostgreSQL | Tenant metadata storage |
| Tenant Databases | PostgreSQL + pgvector | RAG data per tenant |
| Vector Search | pgvector (IVFFlat) | Cosine similarity |
| Encryption | AES-256-GCM | Credential protection |
| LLM | OpenAI GPT-4o | Generation |
| Embeddings | text-embedding-3-small | 1536 dimensions |
| Logging | Pino | Structured JSON logs |
| Styling | Tailwind + shadcn/ui | UI components |
| Validation | Zod | Runtime type safety |
| Deployment | Vercel | Edge + serverless |

---

## Security Considerations

1. **Encryption at Rest**
   - Database URLs encrypted with AES-256-GCM
   - API keys encrypted with AES-256-GCM
   - MASTER_KEY stored in environment only

2. **Tenant Isolation**
   - Physical database separation
   - Connection pool per tenant
   - No cross-tenant data access

3. **Input Validation**
   - Zod schemas on all API inputs
   - Prompt injection detection
   - Input sanitization

4. **Logging Security**
   - Sensitive data sanitization
   - API keys masked in logs
   - Request tracing with UUID

5. **Request Security**
   - X-Trace-Id headers for debugging
   - CORS configuration
   - Rate limiting (TODO)
