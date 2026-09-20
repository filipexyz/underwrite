/**
 * Neon (Postgres) schema — the system of record.
 *
 * Mirrors `docs/CONTRACTS.md`: registry (agents + axes + pairwise trust +
 * wallets), requests, bids, plans, escrows, verifications, ledger_events,
 * attributions, agent_runtime_secrets (hosted HMAC / BYOK / seller-key copy).
 * Money is `double precision`: amounts are fractions of a cent
 * and the ledger — not the column type — is the audit trail.
 */
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  uniqueIndex,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  Attachment,
  AxisVector,
  ChainHop,
  Check,
  ConfidenceBreakdown,
  JudgeVerdict,
  VerificationSpec,
} from "../contracts";
import type { Quote } from "../marketplace/quotes";
import type { AgentPolicy, EngineState } from "../marketplace/types";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const AGENT_STATUSES = ["seed", "pending_claim", "registered", "disabled"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const API_KEY_ROLES = ["buyer", "seller", "admin_service"] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const agents = pgTable("agents", {
  agentId: text("agent_id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  specialties: jsonb("specialties").$type<string[]>().notNull(),
  modelFamily: text("model_family").notNull(),
  model: text("model").notNull(),
  baselineConfidence: doublePrecision("baseline_confidence").notNull(),
  costCeilingUsd: doublePrecision("cost_ceiling_usd").notNull(),
  latencyClass: text("latency_class").notNull(),
  riskTolerance: text("risk_tolerance").notNull(),
  policy: jsonb("policy").$type<AgentPolicy>().notNull(),
  /** `seed` = demo catalog; `registered` = self-serve seller; `disabled` = hidden from hire. */
  status: text("status").$type<AgentStatus>().notNull().default("seed"),
  /** Auth0 `sub` (or `local-dev`). Column name is historical (`owner_clerk_user_id`). */
  ownerUserId: text("owner_clerk_user_id"),
  contact: text("contact"),
  webhookUrl: text("webhook_url"),
  description: text("description"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("agents_status_idx").on(t.status),
  index("agents_owner_idx").on(t.ownerUserId),
]);

/**
 * Hashed API secrets. The plaintext is shown once at create time and never stored.
 * `UNDERWRITE_API_KEY` remains a legacy global bearer for demoday.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").$type<ApiKeyRole>().notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    ownerUserId: text("owner_clerk_user_id"),
    agentId: text("agent_id").references(() => agents.agentId),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("api_keys_owner_idx").on(t.ownerUserId),
    index("api_keys_agent_idx").on(t.agentId),
  ],
);

/** `trust_global`: per agent, per task category. Observed history, EMA-updated. */
export const trustAxes = pgTable(
  "trust_axes",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.agentId),
    category: text("category").notNull(),
    execution: doublePrecision("execution"),
    selection: doublePrecision("selection"),
    underwriting: doublePrecision("underwriting"),
    latency: doublePrecision("latency"),
    costHonesty: doublePrecision("cost_honesty"),
    judgment: doublePrecision("judgment"),
    samples: integer("samples").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.category] })],
);

/** `trust_pairwise(A,B)`: what A thinks of B. Starts empty (D-022). */
export const trustPairwise = pgTable(
  "trust_pairwise",
  {
    fromAgentId: text("from_agent_id")
      .notNull()
      .references(() => agents.agentId),
    toAgentId: text("to_agent_id")
      .notNull()
      .references(() => agents.agentId),
    category: text("category").notNull(),
    trust: doublePrecision("trust").notNull(),
    samples: integer("samples").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.fromAgentId, t.toAgentId, t.category] })],
);

/** Agents are businesses (D-025). System wallets: buyer, marketplace, inference_provider. */
export const wallets = pgTable("wallets", {
  ownerId: text("owner_id").primaryKey(),
  capitalUsd: doublePrecision("capital_usd").notNull(),
  riskTolerance: text("risk_tolerance").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const requests = pgTable(
  "requests",
  {
    requestId: text("request_id").primaryKey(),
    status: text("status").notNull(),
    category: text("category").notNull(),
    requirement: text("requirement").notNull(),
    files: jsonb("files").$type<Attachment[]>().notNull(),
    maxCostUsd: doublePrecision("max_cost_usd").notNull(),
    maxLatencyS: doublePrecision("max_latency_s").notNull(),
    minConfidence: doublePrecision("min_confidence").notNull(),
    failurePolicy: text("failure_policy").notNull(),
    selectionTimeoutS: doublePrecision("selection_timeout_s").notNull(),
    verification: jsonb("verification").$type<VerificationSpec>().notNull(),
    /** Auth0 `sub` / local-dev wallet debited for this request. Null = system `buyer` wallet. */
    buyerWalletId: text("buyer_wallet_id"),
    /** `seed` = Mastra auction loop. `push` = locked marketplace (invite / one plan / best-score). */
    executionMode: text("execution_mode").notNull().default("seed"),
    /** Push path: when the plan window closes (select even if some invitees are silent). */
    planDeadlineAt: timestamp("plan_deadline_at", { withTimezone: true }),
    /** Engine cursor between workflow steps (active chain, escalations, elapsed time). */
    state: jsonb("state").$type<EngineState>(),
    /** Final certificate / failure summary once the loop settles. */
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    workflowRunId: text("workflow_run_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("requests_created_at_idx").on(t.createdAt)],
);

export const bids = pgTable(
  "bids",
  {
    bidId: text("bid_id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.agentId),
    confidence: doublePrecision("confidence").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    latencyS: doublePrecision("latency_s").notNull(),
    chain: jsonb("chain").$type<ChainHop[]>().notNull(),
    /** Full quote tree (per-hop prices, floors, selection evidence) behind the flattened chain. */
    quote: jsonb("quote").$type<Quote>().notNull(),
    rationale: text("rationale").notNull(),
    trustGlobalSnapshot: doublePrecision("trust_global_snapshot").notNull(),
    counterOf: text("counter_of"),
    strategyChosen: text("strategy_chosen").notNull(),
    compliant: boolean("compliant").notNull(),
    rejectionReason: text("rejection_reason"),
    selected: boolean("selected").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("bids_request_idx").on(t.requestId)],
);

export const plans = pgTable(
  "plans",
  {
    planId: text("plan_id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.agentId),
    parentPlanId: text("parent_plan_id"),
    /** Set on a re-plan after escalation: the contract is unchanged, the declared chain is new. */
    supersedesPlanId: text("supersedes_plan_id"),
    deliverable: text("deliverable").notNull(),
    promisedConfidence: doublePrecision("promised_confidence").notNull(),
    maxCostUsd: doublePrecision("max_cost_usd").notNull(),
    estLatencyS: doublePrecision("est_latency_s").notNull(),
    chain: jsonb("chain").$type<ChainHop[]>().notNull(),
    rationale: text("rationale").notNull(),
    planCostUsd: doublePrecision("plan_cost_usd").notNull(),
    stakeUsd: doublePrecision("stake_usd").notNull(),
    strategyConsidered: jsonb("strategy_considered").$type<string[]>().notNull(),
    strategyChosen: text("strategy_chosen").notNull(),
    status: text("status").notNull(),
    rejectionReason: text("rejection_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("plans_request_idx").on(t.requestId)],
);

export const escrows = pgTable(
  "escrows",
  {
    escrowId: text("escrow_id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    hopIndex: integer("hop_index").notNull(),
    payerAgentId: text("payer_agent_id"),
    payeeAgentId: text("payee_agent_id")
      .notNull()
      .references(() => agents.agentId),
    amountUsd: doublePrecision("amount_usd").notNull(),
    stakeUsd: doublePrecision("stake_usd").notNull(),
    minConfidence: doublePrecision("min_confidence").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("escrows_request_idx").on(t.requestId)],
);

export const verifications = pgTable(
  "verifications",
  {
    verificationId: text("verification_id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    planId: text("plan_id").references(() => plans.planId),
    producerAgentId: text("producer_agent_id")
      .notNull()
      .references(() => agents.agentId),
    artifactRef: text("artifact_ref").notNull(),
    checks: jsonb("checks").$type<Check[]>().notNull(),
    confidence: jsonb("confidence").$type<ConfidenceBreakdown>().notNull(),
    verdict: text("verdict").notNull(),
    judges: jsonb("judges").$type<JudgeVerdict[]>().notNull(),
    judgesDisagree: boolean("judges_disagree").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("verifications_request_idx").on(t.requestId)],
);

/** Append-only. `seq` is the total order; `ts` is wall-clock ms. */
export const ledgerEvents = pgTable(
  "ledger_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull().unique(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    parentEventId: text("parent_event_id"),
    type: text("type").notNull(),
    agentId: text("agent_id"),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    latencyMs: doublePrecision("latency_ms").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("ledger_events_request_seq_idx").on(t.requestId, t.seq)],
);

export const attributions = pgTable(
  "attributions",
  {
    attributionId: text("attribution_id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    failedHop: text("failed_hop").notNull(),
    rootCause: text("root_cause").notNull(),
    blamedAgent: text("blamed_agent"),
    evidenceEventIds: jsonb("evidence_event_ids").$type<string[]>().notNull(),
    explanation: text("explanation").notNull(),
    createdAt: createdAt(),
  },
    (t) => [index("attributions_request_idx").on(t.requestId)],
  );

// ---------------------------------------------------------------------------
// Interview pool (Agora + GPT Live) — parallel to the marketplace.
// ---------------------------------------------------------------------------
//
// These types are re-exported from `@/lib/interviews/types` rather than redefined here. They used to
// be duplicated, which meant the zod schema (the actual wire contract) and the column type could drift
// apart silently — adding a field to the brief would compile here and be invisible to the schema.

import type { InterviewAnswers, InterviewBrief, TranscriptTurn } from "@/lib/interviews/types";

export type { InterviewAnswers, InterviewBrief, TranscriptTurn };

export const interviewNeeds = pgTable(
  "interview_needs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    brief: jsonb("brief").$type<InterviewBrief>().notNull(),
    status: text("status").notNull(),
    createdByUserId: text("created_by_clerk_user_id").notNull(),
    publicToken: text("public_token").notNull().unique(),
    assignedSessionId: text("assigned_session_id"),
    resultJson: jsonb("result_json").$type<InterviewAnswers | Record<string, unknown>>(),
    /**
     * The marketplace request this interview produced (handoff.ts). Set exactly once, at finalize.
     * Nullable: needs that were interviewed before the handoff existed, or that failed to convert.
     */
    requestId: text("request_id"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("interview_needs_created_at_idx").on(t.createdAt), index("interview_needs_status_idx").on(t.status)],
);

export const interviewSessions = pgTable(
  "interview_sessions",
  {
    id: text("id").primaryKey(),
    needId: text("need_id")
      .notNull()
      .references(() => interviewNeeds.id),
    agoraChannel: text("agora_channel").notNull(),
    agoraAgentId: text("agora_agent_id"),
    status: text("status").notNull(),
    transcriptJson: jsonb("transcript_json").$type<TranscriptTurn[]>(),
    answersJson: jsonb("answers_json").$type<InterviewAnswers | Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("interview_sessions_need_idx").on(t.needId)],
);

export type AgentRow = typeof agents.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type TrustAxesRow = typeof trustAxes.$inferSelect;
export type TrustPairwiseRow = typeof trustPairwise.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export type BidRow = typeof bids.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type EscrowRow = typeof escrows.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type LedgerEventRow = typeof ledgerEvents.$inferSelect;
export type AttributionRow = typeof attributions.$inferSelect;
export type InterviewNeedRow = typeof interviewNeeds.$inferSelect;
export type InterviewSessionRow = typeof interviewSessions.$inferSelect;

// ---------------------------------------------------------------------------
// Locked marketplace PoC — inbox fallback + invite set
// ---------------------------------------------------------------------------

export const INBOX_MESSAGE_TYPES = ["plan_request", "accepted", "rejected"] as const;
export type InboxMessageType = (typeof INBOX_MESSAGE_TYPES)[number];

export const agentInbox = pgTable(
  "agent_inbox",
  {
    inboxId: text("inbox_id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.agentId),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    type: text("type").$type<InboxMessageType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    deliveredVia: text("delivered_via").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_inbox_agent_idx").on(t.agentId, t.createdAt),
    index("agent_inbox_request_idx").on(t.requestId),
  ],
);

export const jobInvites = pgTable(
  "job_invites",
  {
    inviteId: text("invite_id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.requestId),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.agentId),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_invites_request_idx").on(t.requestId),
    uniqueIndex("job_invites_request_agent_idx").on(t.requestId, t.agentId),
  ],
);

export const AGENT_REGISTRATION_TYPES = ["anonymous", "service_auth"] as const;
export type AgentRegistrationType = (typeof AGENT_REGISTRATION_TYPES)[number];

export const AGENT_REGISTRATION_STATUSES = ["pending", "claimed", "revoked"] as const;
export type AgentRegistrationStatus = (typeof AGENT_REGISTRATION_STATUSES)[number];

/**
 * auth.md registrations. Humans claim via `/claim`; agents exchange the
 * service-signed identity_assertion at `/oauth2/token`.
 */
export const agentRegistrations = pgTable(
  "agent_registrations",
  {
    registrationId: text("registration_id").primaryKey(),
    registrationType: text("registration_type").$type<AgentRegistrationType>().notNull(),
    status: text("status").$type<AgentRegistrationStatus>().notNull(),
    ownerUserId: text("owner_user_id"),
    loginHint: text("login_hint"),
    agentId: text("agent_id").references(() => agents.agentId),
    requestedScopes: jsonb("requested_scopes").$type<string[]>().notNull(),
    preClaimScopes: jsonb("pre_claim_scopes").$type<string[]>().notNull(),
    postClaimScopes: jsonb("post_claim_scopes").$type<string[]>().notNull(),
    assertionJti: text("assertion_jti"),
    assertionExpiresAt: timestamp("assertion_expires_at", { withTimezone: true }),
    claimTokenHash: text("claim_token_hash"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    /** Access tokens minted before this instant are dead (claim / registration revoke). */
    credentialEpoch: timestamp("credential_epoch", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("agent_registrations_owner_idx").on(t.ownerUserId),
    index("agent_registrations_claim_hash_idx").on(t.claimTokenHash),
  ],
);

export const agentClaimAttempts = pgTable(
  "agent_claim_attempts",
  {
    claimAttemptId: text("claim_attempt_id").primaryKey(),
    registrationId: text("registration_id")
      .notNull()
      .references(() => agentRegistrations.registrationId),
    userCode: text("user_code").notNull(),
    claimAttemptTokenHash: text("claim_attempt_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    intervalSeconds: integer("interval_seconds").notNull().default(5),
    lastPollAt: timestamp("last_poll_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_claim_attempts_reg_idx").on(t.registrationId),
    index("agent_claim_attempts_code_idx").on(t.userCode),
    index("agent_claim_attempts_token_idx").on(t.claimAttemptTokenHash),
  ],
);

export const revokedAccessTokens = pgTable("revoked_access_tokens", {
  jti: text("jti").primaryKey(),
  registrationId: text("registration_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentInboxRow = typeof agentInbox.$inferSelect;
export type JobInviteRow = typeof jobInvites.$inferSelect;
export type AgentRegistrationRow = typeof agentRegistrations.$inferSelect;
export type AgentClaimAttemptRow = typeof agentClaimAttempts.$inferSelect;
export type RevokedAccessTokenRow = typeof revokedAccessTokens.$inferSelect;

// ---------------------------------------------------------------------------
// Hosted seller runtime — per-agent credentials (encrypted at rest)
// ---------------------------------------------------------------------------

export const AGENT_RUNTIME_KINDS = ["hosted", "self_hosted"] as const;
export type AgentRuntimeKind = (typeof AGENT_RUNTIME_KINDS)[number];

/**
 * Secrets the hosted Cloudflare worker needs, one row per registered agent.
 * Ciphertexts are AES-256-GCM (`src/lib/crypto/secrets.ts`). Plaintext seller
 * keys stay hashed-only in `api_keys`; this table holds an encrypted copy so
 * the multi-tenant worker can be provisioned without a shared `uw_seller_`.
 */
export const agentRuntimeSecrets = pgTable("agent_runtime_secrets", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.agentId),
  runtimeKind: text("runtime_kind").$type<AgentRuntimeKind>().notNull().default("hosted"),
  sellerKeyCiphertext: text("seller_key_ciphertext"),
  webhookSecretCiphertext: text("webhook_secret_ciphertext").notNull(),
  byokCiphertext: text("byok_ciphertext"),
  byokBaseUrl: text("byok_base_url"),
  byokModel: text("byok_model"),
  sellerKeyId: text("seller_key_id"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type AgentRuntimeSecretsRow = typeof agentRuntimeSecrets.$inferSelect;

export type AxisColumns = Pick<
  TrustAxesRow,
  "execution" | "selection" | "underwriting" | "latency" | "costHonesty" | "judgment"
>;

export function axesFromRow(row: AxisColumns): AxisVector {
  return {
    execution: row.execution,
    selection: row.selection,
    underwriting: row.underwriting,
    latency: row.latency,
    cost_honesty: row.costHonesty,
    judgment: row.judgment,
  };
}
