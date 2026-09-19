CREATE TABLE "interview_needs" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brief" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"assigned_session_id" text,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"need_id" text NOT NULL,
	"agora_channel" text NOT NULL,
	"agora_agent_id" text,
	"status" text NOT NULL,
	"transcript_json" jsonb,
	"answers_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_need_id_interview_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."interview_needs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_needs_created_at_idx" ON "interview_needs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "interview_needs_status_idx" ON "interview_needs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interview_sessions_need_idx" ON "interview_sessions" USING btree ("need_id");