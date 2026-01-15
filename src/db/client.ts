/**
 * Drizzle ORM Database Clients
 *
 * Provides database connections for:
 * - Main database (tenant metadata)
 * - Tenant databases (per-tenant data)
 */

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '@/lib/logger';
import * as mainSchema from './schema/main';
import * as tenantSchema from './schema/tenant';

// Create a child logger for database operations
const log = logger.child({ layer: 'db', service: 'DatabaseClient' });

// =============================================================================
// Types
// =============================================================================

export type MainDatabase = PostgresJsDatabase<typeof mainSchema>;
export type TenantDatabase = PostgresJsDatabase<typeof tenantSchema>;

// =============================================================================
// Main Database Client
// =============================================================================

let mainDbClient: postgres.Sql | null = null;
let mainDb: MainDatabase | null = null;

/**
 * Get the main database Drizzle client.
 * Uses connection string from environment.
 *
 * @returns Drizzle client for main database
 */
export function getMainDb(): MainDatabase {
  if (mainDb) {
    return mainDb;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL environment variable is not set. ' +
      'This should be the connection string for the main database.'
    );
  }

  mainDbClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  mainDb = drizzle(mainDbClient, { schema: mainSchema });

  return mainDb;
}

/**
 * Close the main database connection.
 * Call this during graceful shutdown.
 */
export async function closeMainDb(): Promise<void> {
  if (mainDbClient) {
    await mainDbClient.end();
    mainDbClient = null;
    mainDb = null;
  }
}

// =============================================================================
// Tenant Database Client Factory
// =============================================================================

interface TenantDbConnection {
  client: postgres.Sql;
  db: TenantDatabase;
  createdAt: number;
  lastUsed: number;
}

const tenantConnections = new Map<string, TenantDbConnection>();

const TENANT_POOL_TTL = 5 * 60 * 1000; // 5 minutes
const TENANT_POOL_MAX = 50; // Max cached tenant connections
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the tenant connection pool cleanup.
 */
function startTenantCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(async () => {
    const now = Date.now();

    for (const [slug, conn] of tenantConnections.entries()) {
      if (now - conn.lastUsed > TENANT_POOL_TTL) {
        await conn.client.end();
        tenantConnections.delete(slug);
        log.debug({ tenant: slug }, 'Evicted stale tenant connection');
      }
    }
  }, CLEANUP_INTERVAL);

  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

/**
 * Create a Drizzle client for a tenant's database.
 *
 * @param connectionString - PostgreSQL connection string for tenant DB
 * @param tenantSlug - Tenant identifier (for caching)
 * @returns Drizzle client for tenant database
 */
export function createTenantDb(
  connectionString: string,
  tenantSlug: string
): TenantDatabase {
  // Check cache first
  const cached = tenantConnections.get(tenantSlug);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.db;
  }

  // Start cleanup if not running
  startTenantCleanup();

  // Create new connection
  const client = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(client, { schema: tenantSchema });

  // Evict oldest if pool is full
  if (tenantConnections.size >= TENANT_POOL_MAX) {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [slug, conn] of tenantConnections.entries()) {
      if (conn.lastUsed < oldestTime) {
        oldestTime = conn.lastUsed;
        oldest = slug;
      }
    }

    if (oldest) {
      const conn = tenantConnections.get(oldest);
      if (conn) {
        conn.client.end().catch((err) => {
          log.error({ error: err instanceof Error ? err.message : String(err), tenant: oldest }, 'Failed to close evicted connection');
        });
        tenantConnections.delete(oldest);
        log.debug({ tenant: oldest }, 'Evicted oldest tenant connection');
      }
    }
  }

  // Cache the connection
  tenantConnections.set(tenantSlug, {
    client,
    db,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  });

  log.debug({ tenant: tenantSlug }, 'Created tenant connection');

  return db;
}

/**
 * Clear a specific tenant connection from the pool.
 */
export async function clearTenantConnection(tenantSlug: string): Promise<void> {
  const conn = tenantConnections.get(tenantSlug);
  if (conn) {
    await conn.client.end();
    tenantConnections.delete(tenantSlug);
    log.debug({ tenant: tenantSlug }, 'Cleared tenant connection');
  }
}

/**
 * Clear all tenant connections.
 */
export async function clearAllTenantConnections(): Promise<void> {
  const count = tenantConnections.size;
  const closePromises = Array.from(tenantConnections.values()).map(
    conn => conn.client.end()
  );
  await Promise.all(closePromises);
  tenantConnections.clear();
  log.debug({ count }, 'Cleared all tenant connections');
}

/**
 * Get current pool statistics.
 */
export function getTenantPoolStats(): { size: number; tenants: string[] } {
  return {
    size: tenantConnections.size,
    tenants: Array.from(tenantConnections.keys()),
  };
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Close all database connections.
 * Call this during application shutdown.
 */
export async function closeAllConnections(): Promise<void> {
  await closeMainDb();
  await clearAllTenantConnections();

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  log.info('All database connections closed');
}
