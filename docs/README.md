# Documentation Index

## RAG-Based Q&A SaaS with Multi-Tenant Architecture

Multi-tenant SaaS platform where each tenant gets a **dedicated database** with **AES-256-GCM encrypted** connection strings.

---

## Documentation Structure

```
docs/
├── architecture/                         # All architecture docs
│   ├── 01-architecture-overview.md       # System design, request flow, directory
│   ├── 02-database-schema.md             # Drizzle schemas, tables, indexes
│   ├── 03-multi-tenant-encryption.md     # Encryption, provisioning, security
│   ├── 04-api-specification.md           # REST API endpoints
│   ├── 05-llm-adapter-pattern.md         # Provider-agnostic LLM interface
│   ├── 06-rag-pipeline.md                # Retrieval, chunking, citations
│   ├── 07-component-design.md            # React components, hooks
│   └── 08-deployment-guide.md            # Vercel + Supabase deployment
│
├── edit-history/                         # Session changelogs
│   └── 2026-01-15-session.md
│
└── README.md                             # This file
```

---

## Architecture Documentation

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture Overview](./architecture/01-architecture-overview.md) | System design, request flow, directory structure, tech stack |
| 02 | [Database Schema](./architecture/02-database-schema.md) | Drizzle ORM schemas for main + tenant databases |
| 03 | [Multi-Tenant Encryption](./architecture/03-multi-tenant-encryption.md) | AES-256-GCM encryption, Supabase provisioning, security |
| 04 | [API Specification](./architecture/04-api-specification.md) | REST API endpoints, request/response formats |
| 05 | [LLM Adapter Pattern](./architecture/05-llm-adapter-pattern.md) | Provider-agnostic LLM interface design |
| 06 | [RAG Pipeline](./architecture/06-rag-pipeline.md) | Retrieval, chunking, generation, citations |
| 07 | [Component Design](./architecture/07-component-design.md) | React components, hooks, UI patterns |
| 08 | [Deployment Guide](./architecture/08-deployment-guide.md) | Vercel + Supabase deployment |

---

## Quick Reference

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                   Main Database (DATABASE_URL)                   │
│   tenants table: slug, encrypted_database_url, encrypted_keys   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ decrypt with MASTER_KEY
          ┌─────────────────────┼─────────────────────────────────┐
          ▼                     ▼                                 ▼
   ┌──────────────┐     ┌──────────────┐              ┌──────────────┐
   │ Tenant DB 1  │     │ Tenant DB 2  │     ...      │ Tenant DB N  │
   │ - documents  │     │ - documents  │              │ - documents  │
   │ - chunks     │     │ - chunks     │              │ - chunks     │
   │ - qa_logs    │     │ - qa_logs    │              │ - qa_logs    │
   │ - settings   │     │ - settings   │              │ - settings   │
   └──────────────┘     └──────────────┘              └──────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 14+ (App Router) |
| ORM | Drizzle ORM |
| Main Database | PostgreSQL |
| Tenant Databases | PostgreSQL + pgvector |
| Encryption | AES-256-GCM |
| LLM | OpenAI GPT-4o (adapter pattern) |
| Embeddings | text-embedding-3-small (1536d) |
| Logging | Pino |
| Styling | Tailwind CSS + shadcn/ui |
| Deployment | Vercel |

### Environment Variables

```env
# Main database (tenant metadata)
DATABASE_URL=postgresql://...

# Encryption key (NEVER commit!)
MASTER_KEY=<openssl rand -base64 32>

# Supabase provisioning
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_ORG_ID=your-org-id

# LLM (fallback if tenant doesn't have their own)
OPENAI_API_KEY=sk-...

# Logging
LOG_LEVEL=info
```

---

## Reading Order

### For New Developers
1. [Architecture Overview](./architecture/01-architecture-overview.md) - Start here
2. [Database Schema](./architecture/02-database-schema.md) - Understand data model
3. [Multi-Tenant Encryption](./architecture/03-multi-tenant-encryption.md) - Security model

### For Security Review
1. [Multi-Tenant Encryption](./architecture/03-multi-tenant-encryption.md) - Encryption implementation
2. [API Specification](./architecture/04-api-specification.md) - Endpoint security

### For Frontend Work
1. [Component Design](./architecture/07-component-design.md) - UI components
2. [API Specification](./architecture/04-api-specification.md) - API contracts

### For Deployment
1. [Deployment Guide](./architecture/08-deployment-guide.md) - Vercel + Supabase

---

## Edit History

Session changelogs documenting code changes:

| Date | Summary |
|------|---------|
| [2026-01-16](./edit-history/2026-01-16-session.md) | Provisioning fix (pooler URL), async provisioning, tenant hard delete |
| [2026-01-15](./edit-history/2026-01-15-session.md) | Supabase provisioning, logging system, test coverage |
