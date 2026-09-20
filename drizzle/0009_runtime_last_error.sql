ALTER TABLE "agent_runtime_secrets" ADD COLUMN "last_error" text;
--> statement-breakpoint
ALTER TABLE "agent_runtime_secrets" ADD COLUMN "last_error_at" timestamp with time zone;
