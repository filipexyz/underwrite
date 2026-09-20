CREATE TABLE "agent_runtime_secrets" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"runtime_kind" text DEFAULT 'hosted' NOT NULL,
	"seller_key_ciphertext" text,
	"webhook_secret_ciphertext" text NOT NULL,
	"byok_ciphertext" text,
	"byok_base_url" text,
	"byok_model" text,
	"seller_key_id" text,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runtime_secrets" ADD CONSTRAINT "agent_runtime_secrets_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE no action ON UPDATE no action;
