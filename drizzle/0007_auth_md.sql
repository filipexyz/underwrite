CREATE TABLE "agent_registrations" (
	"registration_id" text PRIMARY KEY NOT NULL,
	"registration_type" text NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" text,
	"login_hint" text,
	"agent_id" text,
	"requested_scopes" jsonb NOT NULL,
	"pre_claim_scopes" jsonb NOT NULL,
	"post_claim_scopes" jsonb NOT NULL,
	"assertion_jti" text,
	"assertion_expires_at" timestamp with time zone,
	"claim_token_hash" text,
	"claim_expires_at" timestamp with time zone,
	"credential_epoch" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_claim_attempts" (
	"claim_attempt_id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"user_code" text NOT NULL,
	"claim_attempt_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"interval_seconds" integer DEFAULT 5 NOT NULL,
	"last_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revoked_access_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"registration_id" text,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_registrations" ADD CONSTRAINT "agent_registrations_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claim_attempts" ADD CONSTRAINT "agent_claim_attempts_registration_id_agent_registrations_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."agent_registrations"("registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_registrations_owner_idx" ON "agent_registrations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_registrations_claim_hash_idx" ON "agent_registrations" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX "agent_claim_attempts_reg_idx" ON "agent_claim_attempts" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "agent_claim_attempts_code_idx" ON "agent_claim_attempts" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "agent_claim_attempts_token_idx" ON "agent_claim_attempts" USING btree ("claim_attempt_token_hash");
