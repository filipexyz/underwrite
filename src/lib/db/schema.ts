/**
 * Neon (Postgres) schema — the system of record.
 *
 * Mirrors `docs/CONTRACTS.md`: registry (agents + axes + pairwise trust +
 * wallets), requests, bids, plans, escrows, verifications, ledger_events,
 * attributions. Money is `double precision`: amounts are fractions of a cent
 * and the ledger — not the column type — is the audit trail.
 */
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
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
  createdAt: createdAt(),
});

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

export type AgentRow = typeof agents.$inferSelect;
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
