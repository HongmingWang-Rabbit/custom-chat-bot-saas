-- Baseline migration: marks existing schema as applied
-- The tenants table already exists in the database
-- This file exists so drizzle-kit tracks future changes correctly

-- Add provisioning columns (idempotent)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS supabase_project_ref VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS encrypted_db_password TEXT;
DO $$ BEGIN
  ALTER TABLE tenants ALTER COLUMN encrypted_database_url DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
