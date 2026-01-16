CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"chunk_index" integer NOT NULL,
	"start_char" integer,
	"end_char" integer,
	"token_count" integer,
	"doc_title" varchar(500),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text NOT NULL,
	"url" varchar(1000),
	"doc_type" varchar(50) DEFAULT 'disclosure',
	"file_name" varchar(255),
	"file_size" integer,
	"mime_type" varchar(100),
	"storage_key" varchar(500),
	"status" varchar(20) DEFAULT 'pending',
	"chunk_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qa_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb,
	"confidence" real DEFAULT 0 NOT NULL,
	"retrieval_scores" jsonb,
	"flagged" boolean DEFAULT false,
	"flagged_at" timestamp with time zone,
	"flagged_reason" varchar(500),
	"reviewed" boolean DEFAULT false,
	"reviewed_at" timestamp with time zone,
	"reviewer_notes" text,
	"debug_info" jsonb DEFAULT '{}'::jsonb,
	"user_agent" varchar(500),
	"ip_address" varchar(45),
	"session_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_doc_id_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_chunks_doc_id" ON "document_chunks" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "idx_documents_status" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_documents_created_at" ON "documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_qa_logs_flagged" ON "qa_logs" USING btree ("flagged");--> statement-breakpoint
CREATE INDEX "idx_qa_logs_created_at" ON "qa_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_qa_logs_confidence" ON "qa_logs" USING btree ("confidence");