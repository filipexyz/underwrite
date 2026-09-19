ALTER TABLE "requests" ADD COLUMN "execution_mode" text DEFAULT 'seed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "plan_deadline_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "agent_inbox" (
	"inbox_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"request_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"delivered_via" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_invites" (
	"invite_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_invites" ADD CONSTRAINT "job_invites_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_invites" ADD CONSTRAINT "job_invites_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_inbox_agent_idx" ON "agent_inbox" USING btree ("agent_id","created_at");
--> statement-breakpoint
CREATE INDEX "agent_inbox_request_idx" ON "agent_inbox" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "job_invites_request_idx" ON "job_invites" USING btree ("request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_invites_request_agent_idx" ON "job_invites" USING btree ("request_id","agent_id");
