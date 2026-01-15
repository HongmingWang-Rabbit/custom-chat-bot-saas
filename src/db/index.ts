/**
 * Database module exports.
 */

// Database clients
export {
  getMainDb,
  closeMainDb,
  createTenantDb,
  clearTenantConnection,
  clearAllTenantConnections,
  getTenantPoolStats,
  closeAllConnections,
} from './client';

export type { MainDatabase, TenantDatabase } from './client';

// Schemas
export * from './schema';
