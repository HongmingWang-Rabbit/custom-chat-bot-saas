#!/usr/bin/env npx tsx
/**
 * Delete Orphan Tenant
 *
 * Removes a tenant record that has no corresponding Supabase project.
 *
 * Usage: npx tsx scripts/delete-orphan-tenant.ts <tenant-slug> [--force]
 *
 * Options:
 *   --force  Skip confirmation prompt
 */

import { eq } from 'drizzle-orm';
import { getMainDb } from '@/db';
import { tenants } from '@/db/schema/main';
import * as readline from 'readline';

/**
 * Prompt user for confirmation.
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function deleteOrphanTenant(slug: string, force: boolean) {
  console.log(`\n🗑️  Deleting orphan tenant: ${slug}\n`);

  const mainDb = getMainDb();

  // Check if tenant exists
  const [tenant] = await mainDb
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug));

  if (!tenant) {
    console.log(`❌ Tenant "${slug}" not found`);
    process.exit(1);
  }

  console.log(`Found tenant:`);
  console.log(`  - Name: ${tenant.name}`);
  console.log(`  - Status: ${tenant.status}`);
  console.log(`  - Project Ref: ${tenant.supabaseProjectRef || 'none'}`);
  console.log(`  - Has DB URL: ${!!tenant.encryptedDatabaseUrl}`);

  // Confirm deletion unless --force is provided
  if (!force) {
    const confirmed = await confirm(`\n⚠️  Are you sure you want to delete tenant "${slug}"?`);
    if (!confirmed) {
      console.log('\nDeletion cancelled.');
      process.exit(0);
    }
  }

  // Delete the tenant record
  await mainDb.delete(tenants).where(eq(tenants.slug, slug));

  console.log(`\n✅ Deleted tenant record: ${slug}`);
  console.log(`\nYou can now recreate the tenant using the provision API.\n`);
}

// Main
const args = process.argv.slice(2);
const forceIndex = args.indexOf('--force');
const force = forceIndex !== -1;
if (forceIndex !== -1) {
  args.splice(forceIndex, 1);
}
const slug = args[0];

if (!slug) {
  console.error('Usage: npx tsx scripts/delete-orphan-tenant.ts <tenant-slug> [--force]');
  process.exit(1);
}

deleteOrphanTenant(slug, force)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
