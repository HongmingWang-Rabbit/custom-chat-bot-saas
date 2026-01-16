-- Migration: Add company_slug column to tenant tables
-- This migration handles existing data by adding columns as nullable first,
-- then backfilling, then adding NOT NULL constraint.

-- Step 1: Add columns as nullable
ALTER TABLE "documents" ADD COLUMN "company_slug" varchar(100);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "company_slug" varchar(100);--> statement-breakpoint
ALTER TABLE "qa_logs" ADD COLUMN "company_slug" varchar(100);--> statement-breakpoint

-- Step 2: Backfill existing data with placeholder (will be same for all rows in tenant DB)
-- Note: In a per-tenant database model, all data belongs to one tenant.
-- The actual slug can be updated later via: UPDATE documents SET company_slug = 'actual-slug';
UPDATE "documents" SET "company_slug" = 'migrated' WHERE "company_slug" IS NULL;--> statement-breakpoint
UPDATE "document_chunks" SET "company_slug" = 'migrated' WHERE "company_slug" IS NULL;--> statement-breakpoint
UPDATE "qa_logs" SET "company_slug" = 'migrated' WHERE "company_slug" IS NULL;--> statement-breakpoint

-- Step 3: Add NOT NULL constraint
ALTER TABLE "documents" ALTER COLUMN "company_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ALTER COLUMN "company_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "qa_logs" ALTER COLUMN "company_slug" SET NOT NULL;--> statement-breakpoint

-- Step 4: Create indexes for efficient filtering
CREATE INDEX "idx_documents_company_slug" ON "documents" USING btree ("company_slug");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_company_slug" ON "document_chunks" USING btree ("company_slug");--> statement-breakpoint
CREATE INDEX "idx_qa_logs_company_slug" ON "qa_logs" USING btree ("company_slug");
