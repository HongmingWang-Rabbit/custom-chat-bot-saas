import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit Configuration
 *
 * This is for the MAIN database (tenant metadata).
 * Tenant databases use the same schema but are provisioned separately.
 *
 * Usage:
 *   npx drizzle-kit generate  # Generate migrations
 *   npx drizzle-kit migrate   # Run migrations
 *   npx drizzle-kit studio    # Open Drizzle Studio
 */
export default defineConfig({
  schema: './src/db/schema/main.ts',
  out: './src/db/migrations/main',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
