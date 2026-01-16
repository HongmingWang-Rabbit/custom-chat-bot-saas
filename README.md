# Cited Investor Q&A - Multi-Tenant RAG SaaS

A production-ready multi-tenant SaaS platform for RAG-powered Q&A on company disclosures. Each tenant gets an isolated database with their documents, embeddings, and Q&A logs.

## Features

- **RAG-Powered Q&A** - Ask questions about company disclosures with cited, grounded answers
- **Multi-Tenant Architecture** - Each tenant gets a dedicated Supabase database
- **Citation System** - Every answer includes verifiable citations to source documents
- **Streaming Responses** - Real-time SSE streaming for better UX
- **Admin Dashboard** - Review Q&A logs, flag responses, manage tenants
- **Security First** - AES-256-GCM encryption, prompt injection defense, input sanitization
- **Provider Agnostic** - LLM adapter pattern supports easy provider switching

## Design Philosophy

This project balances **production-ready infrastructure** with a **focused, non-agentic RAG pipeline**.

### Production Infrastructure

The infrastructure reflects real-world requirements:

| Concern | Solution |
|---------|----------|
| Data isolation | Separate database per tenant (security, compliance) |
| Credential security | AES-256-GCM encryption (can't store keys in plaintext) |
| Performance | Connection pooling, Redis caching (cost & latency control) |
| Observability | Request tracing, structured logging (production debugging) |
| Reliability | Proper error handling, graceful fallbacks |

### Simple RAG Pipeline

The LLM interaction is intentionally straightforward - no agents, no autonomous loops:

```
User Question
    ↓
Embed (single API call)
    ↓
Vector Search (deterministic)
    ↓
Rerank (term matching, no LLM)
    ↓
Generate Answer (single LLM call)
    ↓
Parse Citations (deterministic)
    ↓
Return Response
```

This keeps the AI behavior predictable and auditable while the infrastructure handles production concerns like multi-tenancy, caching, and security.

## Assumptions

The following assumptions were made during development:

1. **Multi-tenant isolation is critical** - Used separate databases per tenant rather than `company_slug` filtering for stronger data isolation, security compliance, and independent scaling.

2. **Documents are pre-processed** - The seed script handles chunking and embedding generation. In production, this would be an async job triggered on document upload.

3. **OpenAI is the LLM provider** - The adapter pattern allows switching providers, but OpenAI is used for both embeddings (text-embedding-3-small) and generation (GPT-4o).

4. **Confidence threshold of 0.25** - Vector similarity scores below this threshold are considered low-confidence and trigger a safe fallback response.

5. **No authentication required** - Per the spec, the admin review page has no auth. In production, this would be protected.

6. **English language only** - The RAG pipeline and prompts are optimized for English documents and queries.

7. **Supabase for hosting** - Tenant databases are Supabase projects, enabling pgvector support and managed infrastructure.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL + pgvector (Supabase) |
| ORM | Drizzle ORM |
| Caching | Upstash Redis |
| LLM | OpenAI GPT-4o |
| Embeddings | OpenAI text-embedding-3-small (1536d) |
| Validation | Zod |
| Document Parsing | pdf-parse, mammoth (DOCX) |
| Encryption | AES-256-GCM (Node.js crypto) |
| Logging | Pino |
| Testing | Vitest, Playwright (E2E) |
| Styling | Tailwind CSS |
| Deployment | Vercel + Supabase |

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL with pgvector extension (or Supabase account)
- OpenAI API key

### Setup

```bash
# Clone and install
git clone <repo-url>
cd custom-chat-bot-saas
npm install

# Configure environment
cp .env.example .env

# Generate encryption key
openssl rand -base64 32
# Add to .env as MASTER_KEY

# Add your OpenAI API key and database URL to .env

# Run migrations
npm run db:push

# Seed demo data
npm run seed

# Start development server
npm run dev
```

Visit:
- **Demo Q&A**: http://localhost:3000/demo/demo-company
- **Admin Dashboard**: http://localhost:3000/admin

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── qa/            # Q&A endpoint (SSE streaming)
│   │   ├── documents/     # Document upload
│   │   ├── tenants/       # Tenant management
│   │   └── qa-logs/       # Q&A log review
│   ├── admin/             # Admin dashboard pages
│   └── demo/              # Public Q&A interface
├── components/            # React components
│   ├── features/          # Feature-specific (qa, admin)
│   └── ui/                # Shared UI components
├── db/                    # Database
│   ├── schema/            # Drizzle schemas (main + tenant)
│   └── migrations/        # Generated migrations
├── lib/                   # Core libraries
│   ├── rag/               # RAG pipeline (retrieval, citations)
│   ├── llm/               # LLM adapters (OpenAI, etc.)
│   ├── crypto/            # AES-256-GCM encryption
│   ├── services/          # Business logic (tenant service)
│   └── supabase/          # Supabase provisioning
└── types/                 # TypeScript types
```

## Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Production build
npm run lint             # ESLint

# Testing
npm run test             # Watch mode
npm run test:run         # Run once
npm run test:coverage    # With coverage report

# Database
npm run db:generate      # Generate migrations
npm run db:push          # Push schema to database
npm run db:studio        # Open Drizzle Studio

# Seeding
npm run seed             # Seed demo data
```

## Architecture

### Two-Database Model

```
┌─────────────────────────────┐
│     Main Database           │
│  (tenant metadata + keys)   │
└──────────────┬──────────────┘
               │ decrypt with MASTER_KEY
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐ ┌─────────────┐
│ Tenant DB 1 │ │ Tenant DB 2 │ ...
│ - documents │ │ - documents │
│ - chunks    │ │ - chunks    │
│ - qa_logs   │ │ - qa_logs   │
└─────────────┘ └─────────────┘
```

### RAG Pipeline

```
Question → Embed → Vector Search → Rerank → Generate Answer → Parse Citations → Log
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Main database connection string |
| `MASTER_KEY` | Yes | AES-256 encryption key (32 bytes base64) |
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings + LLM |
| `SUPABASE_ACCESS_TOKEN` | Yes | For automatic tenant provisioning |
| `SUPABASE_ORG_ID` | Yes | Supabase organization ID |
| `LOG_LEVEL` | No | Logging level (default: info) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/qa` | RAG Q&A with streaming |
| GET | `/api/documents` | List tenant documents |
| POST | `/api/documents/upload` | Upload document |
| GET | `/api/qa-logs` | List Q&A logs |
| PATCH | `/api/qa-logs/[id]` | Flag Q&A log |
| GET | `/api/tenants` | List tenants |
| POST | `/api/tenants` | Create tenant |

## Testing

```bash
# Run all tests
npm run test:run

# Run with coverage
npm run test:coverage

# Current coverage: 96.48% (272 tests)
```

## Documentation

Detailed documentation is available in the `docs/` folder:

- [Architecture Overview](./docs/architecture/01-architecture-overview.md)
- [Database Schema](./docs/architecture/02-database-schema.md)
- [Multi-Tenant Encryption](./docs/architecture/03-multi-tenant-encryption.md)
- [API Specification](./docs/architecture/04-api-specification.md)
- [LLM Adapter Pattern](./docs/architecture/05-llm-adapter-pattern.md)
- [RAG Pipeline](./docs/architecture/06-rag-pipeline.md)
- [Component Design](./docs/architecture/07-component-design.md)
- [Deployment Guide](./docs/architecture/08-deployment-guide.md)

## Future Improvements

With more time, potential enhancements include:

- **Hybrid search** - Combine vector similarity with BM25 keyword search
- **Cross-encoder reranking** - Use a model like `cross-encoder/ms-marco-MiniLM` for better relevance
- **Chunk overlap tuning** - Experiment with different chunking strategies per document type
- **Answer confidence calibration** - Train a classifier on flagged responses to improve confidence scores
- **Rate limiting** - Add per-tenant rate limits for API protection
- **Webhook notifications** - Alert admins when low-confidence answers are generated

## License

MIT
