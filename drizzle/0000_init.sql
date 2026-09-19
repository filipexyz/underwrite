CREATE TABLE "agents" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"specialties" jsonb NOT NULL,
	"model_family" text NOT NULL,
	"model" text NOT NULL,
	"baseline_confidence" double precision NOT NULL,
	"cost_ceiling_usd" double precision NOT NULL,
	"latency_class" text NOT NULL,
	"risk_tolerance" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attributions" (
	"attribution_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"failed_hop" text NOT NULL,
	"root_cause" text NOT NULL,
	"blamed_agent" text,
	"evidence_event_ids" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"bid_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"confidence" double precision NOT NULL,
	"cost_usd" double precision NOT NULL,
	"latency_s" double precision NOT NULL,
	"chain" jsonb NOT NULL,
	"quote" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"trust_global_snapshot" double precision NOT NULL,
	"counter_of" text,
	"strategy_chosen" text NOT NULL,
	"compliant" boolean NOT NULL,
	"rejection_reason" text,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"escrow_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"hop_index" integer NOT NULL,
	"payer_agent_id" text,
	"payee_agent_id" text NOT NULL,
	"amount_usd" double precision NOT NULL,
	"stake_usd" double precision NOT NULL,
	"min_confidence" double precision NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"request_id" text NOT NULL,
	"parent_event_id" text,
	"type" text NOT NULL,
	"agent_id" text,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" double precision DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "ledger_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"parent_plan_id" text,
	"supersedes_plan_id" text,
	"deliverable" text NOT NULL,
	"promised_confidence" double precision NOT NULL,
	"max_cost_usd" double precision NOT NULL,
	"est_latency_s" double precision NOT NULL,
	"chain" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"plan_cost_usd" double precision NOT NULL,
	"stake_usd" double precision NOT NULL,
	"strategy_considered" jsonb NOT NULL,
	"strategy_chosen" text NOT NULL,
	"status" text NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"category" text NOT NULL,
	"requirement" text NOT NULL,
	"files" jsonb NOT NULL,
	"max_cost_usd" double precision NOT NULL,
	"max_latency_s" double precision NOT NULL,
	"min_confidence" double precision NOT NULL,
	"failure_policy" text NOT NULL,
	"selection_timeout_s" double precision NOT NULL,
	"verification" jsonb NOT NULL,
	"state" jsonb,
	"outcome" jsonb,
	"workflow_run_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trust_axes" (
	"agent_id" text NOT NULL,
	"category" text NOT NULL,
	"execution" double precision,
	"selection" double precision,
	"underwriting" double precision,
	"latency" double precision,
	"cost_honesty" double precision,
	"judgment" double precision,
	"samples" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_axes_agent_id_category_pk" PRIMARY KEY("agent_id","category")
);
--> statement-breakpoint
CREATE TABLE "trust_pairwise" (
	"from_agent_id" text NOT NULL,
	"to_agent_id" text NOT NULL,
	"category" text NOT NULL,
	"trust" double precision NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_pairwise_from_agent_id_to_agent_id_category_pk" PRIMARY KEY("from_agent_id","to_agent_id","category")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"verification_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"plan_id" text,
	"producer_agent_id" text NOT NULL,
	"artifact_ref" text NOT NULL,
	"checks" jsonb NOT NULL,
	"confidence" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"judges" jsonb NOT NULL,
	"judges_disagree" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"capital_usd" double precision NOT NULL,
	"risk_tolerance" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attributions" ADD CONSTRAINT "attributions_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_plan_id_plans_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payee_agent_id_agents_agent_id_fk" FOREIGN KEY ("payee_agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_axes" ADD CONSTRAINT "trust_axes_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_pairwise" ADD CONSTRAINT "trust_pairwise_from_agent_id_agents_agent_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_pairwise" ADD CONSTRAINT "trust_pairwise_to_agent_id_agents_agent_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_request_id_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_plan_id_plans_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_producer_agent_id_agents_agent_id_fk" FOREIGN KEY ("producer_agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attributions_request_idx" ON "attributions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "bids_request_idx" ON "bids" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "escrows_request_idx" ON "escrows" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "ledger_events_request_seq_idx" ON "ledger_events" USING btree ("request_id","seq");--> statement-breakpoint
CREATE INDEX "plans_request_idx" ON "plans" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verifications_request_idx" ON "verifications" USING btree ("request_id");