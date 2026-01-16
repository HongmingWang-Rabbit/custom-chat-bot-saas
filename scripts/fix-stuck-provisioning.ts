#!/usr/bin/env npx tsx
/**
 * Fix Stuck Provisioning
 *
 * Fixes tenants stuck in "provisioning" status by:
 * 1. Testing database connection
 * 2. Running migrations if needed
 * 3. Updating status to "active"
 *
 * Usage: npx tsx scripts/fix-stuck-provisioning.ts <tenant-slug>
 */

import { eq } from 'drizzle-orm';
import { getMainDb } from '@/db';
import { tenants, Tenant } from '@/db/schema/main';
import { decrypt } from '@/lib/crypto/encryption';
import { runTenantMigrations } from '@/lib/supabase/tenant-migrations';
import postgres from 'postgres';

// Constants
const DB_CONNECTION_TIMEOUT_SECONDS = 15;

async function fixStuckProvisioning(slug: string) {
  console.log(`\n🔧 Fixing stuck provisioning for: ${slug}\n`);

  const mainDb = getMainDb();

  // Step 1: Get tenant record
  console.log('1. Fetching tenant record...');
  const [tenant] = await mainDb
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug));

  if (!tenant) {
    console.error(`❌ Tenant "${slug}" not found`);
    process.exit(1);
  }

  console.log(`   Status: ${tenant.status}`);
  console.log(`   Has DB URL: ${!!tenant.encryptedDatabaseUrl}`);
  console.log(`   Has Service Key: ${!!tenant.encryptedServiceKey}`);
  console.log(`   Project Ref: ${tenant.supabaseProjectRef || 'not saved'}`);

  if (tenant.status === 'active') {
    console.log('\n✅ Tenant is already active!');
    process.exit(0);
  }

  if (!tenant.encryptedDatabaseUrl) {
    console.error('\n❌ Tenant has no database URL. Cannot fix.');
    console.error('   The Supabase project may not have been created.');
    process.exit(1);
  }

  // Step 2: Decrypt and test database connection
  console.log('\n2. Testing database connection...');
  let databaseUrl: string;
  try {
    databaseUrl = decrypt(tenant.encryptedDatabaseUrl);
    console.log(`   Host: ${tenant.databaseHost}`);
  } catch (error) {
    console.error(`❌ Failed to decrypt database URL: ${error}`);
    process.exit(1);
  }

  // Extract project ref from URL if not saved
  let projectRef = tenant.supabaseProjectRef;
  if (!projectRef) {
    try {
      const url = new URL(databaseUrl);
      const username = url.username;
      const parts = username.split('.');
      if (parts.length >= 2 && parts[0] === 'postgres') {
        projectRef = parts[1];
        console.log(`   Extracted project ref: ${projectRef}`);
      }
    } catch {
      console.log('   Could not extract project ref from URL');
    }
  }

  // Test connection
  try {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: DB_CONNECTION_TIMEOUT_SECONDS });
    await sql`SELECT 1`;
    await sql.end();
    console.log('   ✅ Database connection successful!');
  } catch (error) {
    console.error(`\n❌ Database connection failed: ${error}`);
    console.error('\n   The database might not be ready yet or credentials are wrong.');
    console.error('   Options:');
    console.error('   1. Wait a few minutes and try again');
    console.error('   2. Check the Supabase dashboard for project status');
    console.error('   3. Delete and recreate the tenant');
    process.exit(1);
  }

  // Step 3: Run migrations
  console.log('\n3. Running database migrations...');
  const migrationResult = await runTenantMigrations(databaseUrl);

  if (migrationResult.success) {
    console.log(`   ✅ Migrations completed: ${migrationResult.migrationsRun} migrations run`);
  } else {
    console.error(`   ⚠️  Migrations had errors: ${migrationResult.errors.join(', ')}`);
    console.log('   Continuing anyway...');
  }

  // Step 4: Update tenant status and save project ref
  console.log('\n4. Updating tenant status to "active"...');
  const updateData: Partial<Tenant> = {
    status: 'active',
    updatedAt: new Date(),
  };

  // Save project ref if we extracted it
  if (projectRef && !tenant.supabaseProjectRef) {
    updateData.supabaseProjectRef = projectRef;
    console.log(`   Also saving project ref: ${projectRef}`);
  }

  await mainDb
    .update(tenants)
    .set(updateData)
    .where(eq(tenants.slug, slug));

  console.log('\n✅ Tenant is now active!\n');
  console.log(`   Access the demo at: /demo/${slug}`);
  console.log(`   Upload documents at: /admin/documents\n`);
}

// Main
const slug = process.argv[2];

if (!slug) {
  console.error('Usage: npx tsx scripts/fix-stuck-provisioning.ts <tenant-slug>');
  process.exit(1);
}

fixStuckProvisioning(slug)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
