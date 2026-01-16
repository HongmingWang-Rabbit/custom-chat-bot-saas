# Cited Investor Q&A

A multi-tenant SaaS platform for RAG-powered Q&A on company disclosures. Each tenant gets an isolated database with their documents, embeddings, and Q&A logs.

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

## How to Run

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

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Main database connection string |
| `MASTER_KEY` | Yes | AES-256 encryption key (32 bytes base64) |
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings + LLM |
| `SUPABASE_ACCESS_TOKEN` | Yes | For automatic tenant provisioning |
| `SUPABASE_ORG_ID` | Yes | Supabase organization ID |

### Visit

- **Demo Q&A**: http://localhost:3000/demo/demo-company
- **Admin Dashboard**: http://localhost:3000/admin

## Assumptions

1. **Multi-tenant isolation is critical** - Used separate databases per tenant rather than `company_slug` filtering for stronger data isolation, security compliance, and independent scaling.

2. **Documents are pre-processed** - The seed script handles chunking and embedding generation. In production, this would be an async job triggered on document upload.

3. **OpenAI is the LLM provider** - The adapter pattern allows switching providers, but OpenAI is used for both embeddings (text-embedding-3-small) and generation (GPT-4o).

4. **Confidence threshold of 0.25** - Vector similarity scores below this threshold are considered low-confidence and trigger a safe fallback response.

5. **No authentication required** - Per the spec, the admin review page has no auth. In production, this would be protected.

6. **English language only** - The RAG pipeline and prompts are optimized for English documents and queries.

7. **Supabase for hosting** - Tenant databases are Supabase projects, enabling pgvector support and managed infrastructure.

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
