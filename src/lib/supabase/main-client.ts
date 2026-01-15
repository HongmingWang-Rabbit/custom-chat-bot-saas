import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton main database client.
 * This connects to the central database that stores tenant metadata.
 */
let mainClient: SupabaseClient | null = null;

/**
 * Get the main application database client.
 * Uses service role key for full access to tenant table.
 *
 * @returns Supabase client for main database
 * @throws Error if environment variables are not set
 */
export function createMainClient(): SupabaseClient {
  if (mainClient) {
    return mainClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL environment variable is not set.'
    );
  }

  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY environment variable is not set.'
    );
  }

  mainClient = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return mainClient;
}

/**
 * Get the main client for browser/anon access.
 * Uses anon key - suitable for client-side code.
 *
 * @returns Supabase client with anon key
 */
export function createMainAnonClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.'
    );
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Reset the main client singleton.
 * Useful for testing or when credentials change.
 */
export function resetMainClient(): void {
  mainClient = null;
}
