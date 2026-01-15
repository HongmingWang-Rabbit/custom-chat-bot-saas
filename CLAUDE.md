# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation Maintenance (IMPORTANT)

After making significant code changes, update relevant documentation:

1. **This file (CLAUDE.md)** - Update if architecture, commands, or key modules change
2. **docs/README.md** - Update if adding new features or changing high-level structure
3. **docs/architecture/** - Update if modifying system design or adding new components
4. **docs/edit-history/** - Auto-logged by hooks; summarize at session end

**When to update docs:**
- Adding new API routes or endpoints
- Creating new services or modules
- Changing database schema
- Modifying the RAG pipeline
- Adding new environment variables
- Changing project structure

## Project Overview

Multi-tenant SaaS for RAG-powered Q&A on company disclosures. Each tenant gets an isolated Supabase database with their documents, embeddings, and Q&A logs.

## Commands

```bash
# Development
npm run dev              # Start Next.js dev server
npm run build            # Production build
npm run lint             # ESLint

# Testing
npm run test             # Run vitest in watch mode
npm run test:run         # Run tests once
npm run test:run -- path/to/file.test.ts  # Run single test file

# Database (Main - tenant metadata)
npm run db:generate      # Generate migrations from schema
npm run db:migrate       # Run migrations
npm run db:push          # Push schema directly (dev only)
npm run db:studio        # Open Drizzle Studio

# Database (Tenant - per-tenant schema)
npm run db:generate:tenant   # Generate tenant migrations
TENANT_DATABASE_URL=... npm run db:push:tenant  # Push to specific tenant DB

# Seeding
npm run seed             # Seed demo data
```

## Architecture

### Two-Database Model

```
┌─────────────────────┐      ┌─────────────────────┐
│    Main Database    │      │  Tenant Database(s) │
│  (DATABASE_URL)     │      │  (per tenant)       │
├─────────────────────┤      ├─────────────────────┤
│ tenants             │──┐   │ documents           │
│ - slug              │  │   │ document_chunks     │
│ - encrypted_db_url  │  └──▶│ qa_logs             │
│ - encrypted_keys    │      │ settings            │
└─────────────────────┘      └─────────────────────┘
```

- **Main DB** (`src/db/schema/main.ts`): Stores tenant metadata with encrypted credentials
- **Tenant DBs** (`src/db/schema/tenant.ts`): Each tenant's documents, chunks (with pgvector embeddings), and Q&A logs

### Key Modules

| Path | Purpose |
|------|---------|
| `src/lib/services/tenant-service.ts` | Tenant CRUD, credential encryption/decryption, connection pooling |
| `src/lib/rag/service.ts` | RAG pipeline orchestration: retrieve → rerank → prompt → generate |
| `src/lib/rag/retrieval.ts` | pgvector similarity search with confidence scoring |
| `src/lib/llm/adapter.ts` | Abstract LLM interface for provider switching |
| `src/lib/llm/openai-adapter.ts` | OpenAI implementation |
| `src/db/client.ts` | Drizzle clients with tenant connection pooling (5-min TTL, max 50) |

### RAG Flow

```
POST /api/qa
    │
    ▼
┌─────────────────┐
│ Embed question  │ (OpenAI text-embedding-3-small)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Vector search   │ (pgvector cosine similarity, filtered by tenant)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Rerank chunks   │ (term matching boost)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Generate answer │ (with citation instructions)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Parse citations │ (map [Citation N] to actual chunks)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Log to qa_logs  │
└─────────────────┘
```

### Routes

- `/demo/[tenantSlug]` - Public Q&A interface
- `/admin/review` - Q&A logs review with flagging
- `/admin/tenants` - Tenant management
- `POST /api/qa` - RAG query endpoint (supports streaming via SSE)

### Tenant Isolation

All queries filter by tenant context. Tenant credentials are AES-256-GCM encrypted in the main database. The `TenantService` handles decryption and maintains a connection pool with automatic eviction.

## Environment Variables

Required:
- `DATABASE_URL` - Main database connection string
- `MASTER_KEY` - AES encryption key (generate with `openssl rand -base64 32`)
- `OPENAI_API_KEY` - For embeddings and LLM
- `SUPABASE_ACCESS_TOKEN` - Management API for tenant provisioning
- `SUPABASE_ORG_ID` - Organization for new tenant projects

## Testing Structure

Tests are co-located with source files in `__tests__` folders:
```
src/lib/rag/
├── service.ts
├── retrieval.ts
└── __tests__/
    ├── service.test.ts
    └── retrieval.test.ts
```

## Hooks

Claude Code hooks are configured in `.claude/settings.json`:

- **PostToolUse (Edit/Write)**: Logs all file modifications to `docs/edit-history/YYYY-MM-DD-session.md`

The edit log captures timestamp, action, and file path for each change.

**End of session workflow:**
Run `/update-docs` to automatically review changes and update documentation.

Manual steps if needed:
1. Review `docs/edit-history/YYYY-MM-DD-session.md` for all changes made
2. Add summary section describing what was accomplished
3. Update CLAUDE.md if architecture/commands changed
4. Update docs/README.md if features changed
5. Update docs/architecture/ if system design changed

## Custom Commands

| Command | Description |
|---------|-------------|
| `/update-docs` | Review recent edits and update all relevant documentation |
| `/code-review` | Review code for best practices, modularity, scalability, abstraction, and test coverage |

## MCP Servers

Project-level MCP servers in `.claude/settings.json`:

| Server | Purpose |
|--------|---------|
| `chrome-devtools` | Browser automation, DOM inspection, console access |
| `supabase` | Direct database queries, schema inspection for project `jdxhoqdnxshzbjasfhfz` |
