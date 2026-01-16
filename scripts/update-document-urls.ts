/**
 * Update Document URLs Script
 *
 * Updates existing documents with URLs for download.
 *
 * Usage:
 *   npx tsx scripts/update-document-urls.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

const DOCUMENT_URLS: Record<string, { url: string; fileName: string; mimeType: string }> = {
  'Q3 2024 Earnings Report': {
    url: '/documents/q3-2024-earnings-report.txt',
    fileName: 'q3-2024-earnings-report.txt',
    mimeType: 'text/plain',
  },
  'Risk Factors Disclosure': {
    url: '/documents/risk-factors-disclosure.txt',
    fileName: 'risk-factors-disclosure.txt',
    mimeType: 'text/plain',
  },
  'Company FAQ': {
    url: '/documents/company-faq.txt',
    fileName: 'company-faq.txt',
    mimeType: 'text/plain',
  },
  'Corporate Governance': {
    url: '/documents/corporate-governance.txt',
    fileName: 'corporate-governance.txt',
    mimeType: 'text/plain',
  },
};

async function updateUrls() {
  console.log('\n📄 Updating document URLs...\n');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  let updatedCount = 0;
  let skippedCount = 0;

  try {
    for (const [title, info] of Object.entries(DOCUMENT_URLS)) {
      const result = await db.execute(sql`
        UPDATE documents
        SET url = ${info.url}, file_name = ${info.fileName}, mime_type = ${info.mimeType}
        WHERE title = ${title}
      `);

      // Check if any rows were affected
      const rowCount = (result as { rowCount?: number }).rowCount ?? 0;

      if (rowCount > 0) {
        console.log(`  ✓ Updated: ${title}`);
        updatedCount++;
      } else {
        console.log(`  ⚠ Not found: ${title}`);
        skippedCount++;
      }
    }

    console.log(`\n✅ Done! Updated: ${updatedCount}, Skipped: ${skippedCount}\n`);

    if (skippedCount > 0) {
      console.log('Note: Some documents were not found. Run "npm run seed" to create them.\n');
    }
  } finally {
    await client.end();
  }
}

updateUrls().catch((error) => {
  console.error('\n❌ Update failed:', error.message);
  process.exit(1);
});
