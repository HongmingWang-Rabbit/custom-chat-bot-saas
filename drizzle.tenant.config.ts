import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit Configuration for Tenant Databases
 *
 * This generates migrations for tenant databases.
 * Use TENANT_DATABASE_URL to point to a tenant database.
 *
 * Usage:
 *   TENANT_DATABASE_URL=... npx drizzle-kit generate --config=drizzle.tenant.config.ts
 */
export default defineConfig({
  schema: './src/db/schema/tenant.ts',
  out: './src/db/migrations/tenant',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TENANT_DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
