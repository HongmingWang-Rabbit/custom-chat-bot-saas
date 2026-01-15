/**
 * Database Seed Script
 *
 * Seeds test data for local development:
 * 1. Creates main database tables
 * 2. Creates a test tenant
 * 3. Creates tenant database tables
 * 4. Seeds sample documents with embeddings
 *
 * Usage:
 *   npm run seed
 *
 * Environment:
 *   DATABASE_URL - Main database connection string
 *   OPENAI_API_KEY - For generating embeddings
 *   MASTER_KEY - For encrypting tenant credentials
 *
 * Note: For local testing, the tenant can use the same database as main.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

// =============================================================================
// Configuration
// =============================================================================

const TEST_TENANT = {
  slug: 'demo-company',
  name: 'Demo Company Inc.',
};

const SAMPLE_DOCUMENTS = [
  {
    title: 'Q3 2024 Earnings Report',
    docType: 'report',
    content: `
Demo Company Inc. Q3 2024 Earnings Report

Executive Summary:
Demo Company Inc. delivered strong financial results in Q3 2024, exceeding analyst expectations across key metrics. Revenue grew 25% year-over-year to $150 million, driven by robust demand in our enterprise software segment.

Key Financial Highlights:
- Revenue: $150 million (up 25% YoY)
- Gross Profit: $112.5 million (75% gross margin)
- Operating Income: $37.5 million (25% operating margin)
- Net Income: $30 million (20% net margin)
- Earnings Per Share: $1.50 (diluted)
- Free Cash Flow: $45 million

Revenue Breakdown by Segment:
- Enterprise Software: $90 million (60% of revenue, up 30% YoY)
- Cloud Services: $45 million (30% of revenue, up 20% YoY)
- Professional Services: $15 million (10% of revenue, up 10% YoY)

Geographic Distribution:
- North America: 55% of revenue
- Europe: 25% of revenue
- Asia Pacific: 15% of revenue
- Rest of World: 5% of revenue

Customer Metrics:
- Total customers: 2,500+ (up from 2,100 in Q3 2023)
- Enterprise customers: 450 (up from 380)
- Net Revenue Retention: 115%
- Customer Acquisition Cost: Improved by 15%

Guidance for Q4 2024:
We expect continued momentum with Q4 revenue projected between $155-160 million. Full year 2024 revenue is expected to reach $575-585 million, representing 23-25% annual growth.
    `.trim(),
  },
  {
    title: 'Risk Factors Disclosure',
    docType: 'disclosure',
    content: `
Risk Factors

Investing in Demo Company Inc. involves significant risks. Prospective investors should carefully consider the following risk factors before making an investment decision.

Market and Competition Risks:
1. Intense Competition: We operate in highly competitive markets with established players including large technology companies with greater resources. Our competitors may develop superior products or acquire customers at lower costs.

2. Market Adoption: The enterprise software market is subject to rapid technological changes. Our success depends on customers adopting our solutions and continued market acceptance of cloud-based software.

3. Economic Conditions: Adverse economic conditions may reduce customer spending on software and technology services, negatively impacting our revenue growth.

Operational Risks:
1. Key Personnel: Our success depends on key executives and technical personnel. Loss of key employees could adversely affect our business operations.

2. Cybersecurity: We process and store sensitive customer data. Security breaches or data incidents could damage our reputation and result in legal liability.

3. Service Disruptions: Our cloud services require high availability. System outages or performance degradation could lead to customer losses and reputational harm.

4. International Operations: Operating in multiple countries exposes us to currency fluctuations, regulatory complexity, and geopolitical risks.

Financial Risks:
1. Customer Concentration: Our top 10 customers represent approximately 35% of annual revenue. Loss of major customers could significantly impact our financial results.

2. Revenue Recognition: Complex multi-year contracts may result in revenue timing variations that affect quarterly results.

3. Investment Requirements: Continued growth requires significant investment in research, development, sales, and marketing, which may impact short-term profitability.

Regulatory and Compliance Risks:
1. Data Privacy: Evolving data protection regulations including GDPR and CCPA require ongoing compliance investments and may restrict our data processing activities.

2. Industry Regulations: Our customers in regulated industries may be subject to specific compliance requirements affecting their purchasing decisions.
    `.trim(),
  },
  {
    title: 'Company FAQ',
    docType: 'faq',
    content: `
Frequently Asked Questions

About the Company:

Q: When was Demo Company founded?
A: Demo Company Inc. was founded in 2015 by Jane Smith and John Doe with a mission to transform enterprise software through innovative cloud solutions.

Q: Where is Demo Company headquartered?
A: Our headquarters is located in San Francisco, California. We have additional offices in New York, London, Singapore, and Sydney.

Q: How many employees does Demo Company have?
A: As of Q3 2024, we employ approximately 1,200 team members globally, with plans to grow to 1,500 by the end of 2025.

Products and Services:

Q: What products does Demo Company offer?
A: We offer three main product lines: (1) Enterprise Platform - a comprehensive business management suite, (2) Cloud Analytics - advanced data analytics and business intelligence tools, and (3) Integration Hub - APIs and connectors for system integration.

Q: What industries do you serve?
A: We primarily serve financial services, healthcare, retail, manufacturing, and technology companies. Our solutions are designed to be industry-agnostic but include specialized features for these verticals.

Q: Do you offer a free trial?
A: Yes, we offer a 30-day free trial for our Cloud Analytics product. Enterprise Platform requires a custom demo and proof-of-concept engagement.

Investment Information:

Q: Is Demo Company publicly traded?
A: Yes, Demo Company trades on NASDAQ under the ticker symbol "DEMO". We completed our IPO in March 2022.

Q: Does Demo Company pay dividends?
A: Currently, we do not pay dividends. We reinvest profits into research, development, and growth initiatives.

Q: What is your growth strategy?
A: Our growth strategy focuses on three pillars: (1) expanding our enterprise customer base, (2) increasing product adoption within existing accounts, and (3) strategic acquisitions to enhance our technology platform.

Support and Resources:

Q: How can I contact investor relations?
A: You can reach our investor relations team at investors@democompany.com or call our investor hotline at 1-800-DEMO-INV.

Q: Where can I find financial reports?
A: All SEC filings, earnings reports, and investor presentations are available on our investor relations website at ir.democompany.com.
    `.trim(),
  },
  {
    title: 'Corporate Governance',
    docType: 'filing',
    content: `
Corporate Governance Overview

Board of Directors:
Demo Company is committed to maintaining the highest standards of corporate governance. Our board consists of 9 directors, 7 of whom are independent.

Board Composition:
- Jane Smith, CEO and Chair
- John Doe, Co-Founder and CTO
- Sarah Johnson, Independent Director (Audit Committee Chair)
- Michael Chen, Independent Director (Compensation Committee Chair)
- Emily Davis, Independent Director (Nominating Committee Chair)
- Robert Wilson, Independent Director
- Lisa Anderson, Independent Director
- David Brown, Independent Director
- Jennifer Taylor, Independent Director

Board Committees:
1. Audit Committee: Oversees financial reporting, internal controls, and external audits. Meets quarterly and includes only independent directors.

2. Compensation Committee: Determines executive compensation, equity awards, and reviews company-wide compensation policies.

3. Nominating and Governance Committee: Identifies board candidates, oversees governance practices, and reviews board performance.

Executive Compensation Philosophy:
Our compensation programs are designed to attract, retain, and motivate top talent while aligning executive interests with shareholder value creation. Key principles include:
- Pay for performance with significant variable compensation
- Long-term equity incentives aligned with shareholder returns
- Competitive base salaries benchmarked to peer companies
- Clawback provisions for executive bonuses

Code of Conduct:
All employees, officers, and directors are required to comply with our Code of Business Conduct and Ethics. The code addresses conflicts of interest, confidentiality, fair dealing, compliance with laws, and reporting of violations.

Shareholder Rights:
- Annual meeting participation and voting
- Proxy access for qualifying shareholders
- Majority voting standard for director elections
- No poison pill or staggered board provisions

ESG Commitment:
We are committed to environmental, social, and governance excellence. Recent initiatives include carbon neutrality targets, diversity and inclusion programs, and enhanced data privacy practices.
    `.trim(),
  },
];

// =============================================================================
// Encryption Utilities
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const masterKeyBase64 = process.env.MASTER_KEY;
  if (!masterKeyBase64) {
    throw new Error('MASTER_KEY environment variable is not set');
  }
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY must be 32 bytes (256 bits) when decoded');
  }
  return key;
}

function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

// =============================================================================
// Embedding Service
// =============================================================================

async function generateEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });

  console.log(`Generating embeddings for ${texts.length} chunks...`);

  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
      dimensions: 1536,
    });

    const sortedData = response.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sortedData.map((d) => d.embedding));

    console.log(`  Processed ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks`);
  }

  return allEmbeddings;
}

// =============================================================================
// Chunking
// =============================================================================

interface Chunk {
  content: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
}

function chunkText(text: string, chunkSize = 500, overlap = 50): Chunk[] {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (normalized.length <= chunkSize) {
    return [{
      content: normalized,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: normalized.length,
    }];
  }

  const chunks: Chunk[] = [];
  let pos = 0;
  let idx = 0;

  while (pos < normalized.length) {
    let end = Math.min(pos + chunkSize, normalized.length);

    // Find sentence boundary
    if (end < normalized.length) {
      const searchStart = Math.max(pos + 100, end - 100);
      const region = normalized.slice(searchStart, end);
      const match = region.match(/[.!?]\s+/g);
      if (match) {
        const lastMatch = region.lastIndexOf(match[match.length - 1]);
        if (lastMatch >= 0) {
          end = searchStart + lastMatch + match[match.length - 1].length;
        }
      }
    }

    const content = normalized.slice(pos, end).trim();
    if (content) {
      chunks.push({ content, chunkIndex: idx++, startOffset: pos, endOffset: end });
    }

    pos += Math.max(1, end - pos - overlap);
  }

  return chunks;
}

// =============================================================================
// Main Seed Function
// =============================================================================

async function seed() {
  console.log('\n🌱 Starting database seed...\n');

  // Check required environment variables
  const databaseUrl = process.env.DATABASE_URL;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const masterKey = process.env.MASTER_KEY;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  if (!masterKey) {
    throw new Error('MASTER_KEY environment variable is required');
  }

  // Connect to database
  console.log('📦 Connecting to database...');
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    // =========================================================================
    // Step 1: Create main database tables
    // =========================================================================
    console.log('\n📋 Creating main database tables...');

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        encrypted_database_url TEXT NOT NULL,
        encrypted_service_key TEXT,
        encrypted_anon_key TEXT,
        encrypted_llm_api_key TEXT,
        database_host VARCHAR(255),
        database_region VARCHAR(50),
        branding JSONB DEFAULT '{"primaryColor":"#3B82F6","secondaryColor":"#1E40AF","backgroundColor":"#FFFFFF","textColor":"#1F2937","accentColor":"#10B981","fontFamily":"Inter, system-ui, sans-serif","borderRadius":"8px","logoUrl":null,"customCss":null}'::jsonb,
        llm_provider VARCHAR(50) DEFAULT 'openai',
        rag_config JSONB DEFAULT '{"topK":5,"confidenceThreshold":0.6,"chunkSize":500,"chunkOverlap":50}'::jsonb,
        status VARCHAR(20) DEFAULT 'active',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ tenants table created');

    // =========================================================================
    // Step 2: Create tenant database tables (using same DB for local dev)
    // =========================================================================
    console.log('\n📋 Creating tenant database tables...');

    // Enable pgvector extension
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log('  ✓ pgvector extension enabled');

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        url VARCHAR(1000),
        doc_type VARCHAR(50) DEFAULT 'disclosure',
        file_name VARCHAR(255),
        file_size INTEGER,
        mime_type VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        chunk_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ documents table created');

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding vector(1536),
        chunk_index INTEGER NOT NULL,
        start_char INTEGER,
        end_char INTEGER,
        token_count INTEGER,
        doc_title VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ document_chunks table created');

    // Create vector index
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
      ON document_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `).catch(() => {
      // IVFFlat requires data to be present first, create after seeding
      console.log('  ⚠ Vector index will be created after seeding data');
    });

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qa_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations JSONB DEFAULT '[]'::jsonb,
        confidence REAL NOT NULL DEFAULT 0,
        retrieval_scores JSONB,
        flagged BOOLEAN DEFAULT false,
        flagged_at TIMESTAMPTZ,
        flagged_reason VARCHAR(500),
        reviewed BOOLEAN DEFAULT false,
        reviewed_at TIMESTAMPTZ,
        reviewer_notes TEXT,
        debug_info JSONB DEFAULT '{}'::jsonb,
        user_agent VARCHAR(500),
        ip_address VARCHAR(45),
        session_id VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ qa_logs table created');

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ settings table created');

    // =========================================================================
    // Step 3: Create test tenant
    // =========================================================================
    console.log('\n👤 Creating test tenant...');

    // Delete existing test tenant if exists
    await db.execute(sql`DELETE FROM tenants WHERE slug = ${TEST_TENANT.slug}`);

    // For local testing, use the same database URL
    const encryptedDbUrl = encrypt(databaseUrl);
    const encryptedServiceKey = encrypt('test-service-key');
    const encryptedAnonKey = encrypt('test-anon-key');

    await db.execute(sql`
      INSERT INTO tenants (slug, name, encrypted_database_url, encrypted_service_key, encrypted_anon_key, database_host)
      VALUES (
        ${TEST_TENANT.slug},
        ${TEST_TENANT.name},
        ${encryptedDbUrl},
        ${encryptedServiceKey},
        ${encryptedAnonKey},
        'localhost'
      )
    `);
    console.log(`  ✓ Created tenant: ${TEST_TENANT.name} (${TEST_TENANT.slug})`);

    // =========================================================================
    // Step 4: Seed sample documents
    // =========================================================================
    console.log('\n📄 Seeding sample documents...');

    // Clear existing documents
    await db.execute(sql`DELETE FROM document_chunks`);
    await db.execute(sql`DELETE FROM documents`);

    for (const doc of SAMPLE_DOCUMENTS) {
      console.log(`\n  Processing: ${doc.title}`);

      // Insert document
      const docResult = await db.execute(sql`
        INSERT INTO documents (title, content, doc_type, status)
        VALUES (${doc.title}, ${doc.content}, ${doc.docType}, 'processing')
        RETURNING id
      `);
      const docId = docResult[0].id;

      // Chunk the document
      const chunks = chunkText(doc.content);
      console.log(`    Created ${chunks.length} chunks`);

      // Generate embeddings
      const embeddings = await generateEmbeddings(
        chunks.map((c) => c.content),
        openaiApiKey
      );

      // Insert chunks with embeddings
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        const embeddingStr = `[${embedding.join(',')}]`;

        await db.execute(sql`
          INSERT INTO document_chunks (doc_id, content, embedding, chunk_index, start_char, end_char, doc_title, token_count)
          VALUES (
            ${docId},
            ${chunk.content},
            ${embeddingStr}::vector,
            ${chunk.chunkIndex},
            ${chunk.startOffset},
            ${chunk.endOffset},
            ${doc.title},
            ${Math.ceil(chunk.content.length / 4)}
          )
        `);
      }

      // Update document status
      await db.execute(sql`
        UPDATE documents
        SET status = 'ready', chunk_count = ${chunks.length}, updated_at = NOW()
        WHERE id = ${docId}
      `);

      console.log(`    ✓ Document seeded with embeddings`);
    }

    // =========================================================================
    // Step 5: Create vector index (now that we have data)
    // =========================================================================
    console.log('\n🔍 Creating vector search index...');
    try {
      await db.execute(sql`DROP INDEX IF EXISTS idx_document_chunks_embedding`);
      await db.execute(sql`
        CREATE INDEX idx_document_chunks_embedding
        ON document_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 10)
      `);
      console.log('  ✓ IVFFlat index created');
    } catch (error) {
      console.log('  ⚠ Could not create IVFFlat index (may need more data)');
      // Fall back to HNSW which doesn't require training
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
      `);
      console.log('  ✓ HNSW index created as fallback');
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n✅ Seed completed successfully!\n');
    console.log('Summary:');
    console.log(`  - Tenant: ${TEST_TENANT.name}`);
    console.log(`  - Documents: ${SAMPLE_DOCUMENTS.length}`);
    console.log(`  - Demo URL: http://localhost:3000/demo/${TEST_TENANT.slug}`);
    console.log(`  - Admin URL: http://localhost:3000/admin`);
    console.log('\nStart the dev server with: npm run dev\n');

  } finally {
    await client.end();
  }
}

// =============================================================================
// Run Seed
// =============================================================================

seed().catch((error) => {
  console.error('\n❌ Seed failed:', error.message);
  process.exit(1);
});
