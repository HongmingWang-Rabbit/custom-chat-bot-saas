# Deployment Guide

## Overview

This guide covers deploying the RAG Q&A SaaS to Vercel with Supabase as the database backend.

---

## Prerequisites

- Node.js 18+ installed
- GitHub account
- Vercel account (free tier works)
- Supabase account (free tier works)
- OpenAI API key

---

## 1. Supabase Setup

### Create Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a region close to your users
3. Set a strong database password (save this!)
4. Wait for project to provision (~2 minutes)

### Enable pgvector Extension

1. Go to **Database** > **Extensions**
2. Search for "vector"
3. Enable the `vector` extension

Or via SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Run Migrations

Execute migrations in order in the SQL Editor:

**Migration 1: Companies Table**
```sql
-- See docs/02-database-schema.md for full SQL
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    branding JSONB DEFAULT '{...}'::jsonb,
    llm_config JSONB DEFAULT '{...}'::jsonb,
    rag_config JSONB DEFAULT '{...}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Continue with migrations for `documents`, `document_chunks`, `qa_logs`, and `match_documents` function.

### Get Connection Details

1. Go to **Settings** > **API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. OpenAI Setup

### Get API Key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key → `OPENAI_API_KEY`

### Check Model Access

Ensure your account has access to:
- `gpt-4o` (or `gpt-4o-mini` for lower cost)
- `text-embedding-3-small`

---

## 3. Local Development

### Clone and Install

```bash
cd custom-chat-bot-saas
npm install
```

### Configure Environment

Create `.env.local`:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenAI
OPENAI_API_KEY=sk-...
```

### Seed Database

```bash
npm run seed
```

This creates:
- Sample companies
- Sample documents
- Document chunks with embeddings

### Start Development Server

```bash
npm run dev
```

Visit:
- `http://localhost:3000/demo/example-co` - Public Q&A
- `http://localhost:3000/admin/review` - Admin review

---

## 4. Vercel Deployment

### Connect Repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Select the repository

### Configure Build

Vercel auto-detects Next.js. Defaults should work:
- **Framework Preset:** Next.js
- **Build Command:** `next build`
- **Output Directory:** `.next`

### Add Environment Variables

In Vercel project settings, add:

| Variable | Value | Environment |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase URL | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key | All |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key | All |
| `OPENAI_API_KEY` | OpenAI API key | All |

### Deploy

1. Click **Deploy**
2. Wait for build to complete
3. Visit your deployment URL

---

## 5. Post-Deployment

### Verify Endpoints

Test each endpoint:

```bash
# Health check
curl https://your-app.vercel.app/api/health

# Test Q&A (replace with your company slug)
curl -X POST https://your-app.vercel.app/api/qa \
  -H "Content-Type: application/json" \
  -d '{"companySlug":"example-co","question":"What does the company do?"}'
```

### Monitor

- **Vercel Dashboard:** Check function logs, errors, and performance
- **Supabase Dashboard:** Monitor database queries and usage

---

## 6. Configuration

### `vercel.json` (Optional)

```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

### Region Selection

Choose a region close to:
1. Your Supabase project region
2. Your primary user base

| Vercel Region | Location |
|---------------|----------|
| `iad1` | Washington D.C. |
| `sfo1` | San Francisco |
| `cdg1` | Paris |
| `hnd1` | Tokyo |

---

## 7. Custom Domain (Optional)

### Add Domain

1. Go to Vercel project **Settings** > **Domains**
2. Add your domain (e.g., `qa.yourcompany.com`)
3. Configure DNS as instructed

### SSL

Vercel automatically provisions SSL certificates.

---

## 8. Production Checklist

### Before Going Live

- [ ] All environment variables set in Vercel
- [ ] Database migrations applied
- [ ] Seed data loaded (or production documents uploaded)
- [ ] Test Q&A flow end-to-end
- [ ] Test admin review page
- [ ] Verify streaming works
- [ ] Check error handling for edge cases

### Security

- [ ] Service role key is NOT exposed client-side
- [ ] API routes validate input
- [ ] Rate limiting considered (future)
- [ ] CORS configured if needed

### Performance

- [ ] Database indexes created
- [ ] pgvector index optimized for data size
- [ ] Consider edge caching for static assets

---

## 9. Monitoring & Maintenance

### Vercel Analytics

Enable Vercel Analytics for:
- Request volume
- Response times
- Error rates

### Supabase Monitoring

Monitor in Supabase dashboard:
- Query performance
- Database size
- Connection count

### Log Queries (Debug)

Check slow queries:
```sql
SELECT
    query,
    calls,
    mean_time,
    total_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

---

## 10. Scaling Considerations

### Database

For high traffic:
1. **Upgrade Supabase plan** for more connections
2. **Add read replicas** for read-heavy workloads
3. **Optimize pgvector index** (HNSW for larger datasets)

### API

Vercel serverless scales automatically. For sustained high load:
1. Consider **Vercel Pro** for longer timeouts
2. Implement **caching** for repeated queries
3. Add **rate limiting** per company

### Cost Optimization

| Service | Free Tier | Cost Driver |
|---------|-----------|-------------|
| Vercel | 100GB bandwidth | Function invocations |
| Supabase | 500MB DB | Storage + egress |
| OpenAI | N/A | Tokens (input + output) |

**OpenAI Cost Estimation:**
- GPT-4o: ~$5/1M input tokens, ~$15/1M output tokens
- Embeddings: ~$0.02/1M tokens
- Average Q&A: ~$0.01-0.03 per query

---

## 11. Troubleshooting

### Common Issues

**"Company not found" error**
- Check company slug exists in database
- Verify `is_active` is true

**Empty retrieval results**
- Check embeddings exist in `document_chunks`
- Lower confidence threshold in `rag_config`
- Verify `match_documents` function exists

**Streaming not working**
- Check browser supports SSE
- Verify no proxy buffering
- Check Vercel function timeout

**Slow responses**
- Check database indexes
- Monitor OpenAI API latency
- Consider reducing `topK` value

### Debug Mode

Enable debug info in responses:
```typescript
// In API route
return NextResponse.json({
  ...response,
  debug: {
    retrieval_ms,
    llm_ms,
    total_ms,
    model,
    chunks_retrieved,
  }
});
```

### Logs

**Vercel Logs:**
```bash
vercel logs --follow
```

**Supabase Logs:**
Check **Logs** > **Edge Logs** in dashboard

---

## 12. Rollback

### Vercel Rollback

1. Go to **Deployments**
2. Find previous working deployment
3. Click **...** > **Promote to Production**

### Database Rollback

Keep migration rollback scripts:
```sql
-- Rollback example
DROP TABLE IF EXISTS qa_logs;
DROP TABLE IF EXISTS document_chunks;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS companies;
```

---

## Quick Reference

### Environment Variables

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=

# Optional (for other providers)
ANTHROPIC_API_KEY=
AZURE_OPENAI_API_KEY=
```

### URLs

| Environment | URL |
|-------------|-----|
| Local | `http://localhost:3000` |
| Preview | `https://[branch]-[project].vercel.app` |
| Production | `https://your-domain.vercel.app` |

### Commands

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run start    # Start production server
npm run seed     # Seed database
npm run lint     # Run linter
```
