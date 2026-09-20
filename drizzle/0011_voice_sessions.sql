-- Voice task composer sessions (signed-in surface).
--
-- Hand-written, and the `when` in drizzle/meta/_journal.json for this entry is set above every
-- existing stamp on purpose: drizzle's migrator applies a migration only when its `folderMillis` is
-- greater than the latest already applied, and skips anything lower **silently**. scripts/migrate.ts
-- now refuses to run if the newest entry is not the newest by timestamp.
CREATE TABLE "voice_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"agora_channel" text NOT NULL,
	"agora_agent_id" text,
	"transcript_json" jsonb,
	"brief_json" jsonb,
	"request_id" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "voice_sessions_user_idx" ON "voice_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "voice_sessions_started_idx" ON "voice_sessions" USING btree ("started_at");
