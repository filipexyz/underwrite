/**
 * Data contracts — a 1:1 mirror of `docs/CONTRACTS.md`.
 *
 * Every shape here is the wire/storage shape. Runtime validation is Zod; the
 * inferred TypeScript types are what the engine, API and console consume.
 * Section numbers reference CONTRACTS.md.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export const AgentRole = z.enum(["delegator", "intermediary", "executor", "judge"]);
export type AgentRole = z.infer<typeof AgentRole>;

export const Strategy = z.enum(["self", "decompose", "outsource"]);
export type Strategy = z.infer<typeof Strategy>;

export const FailurePolicy = z.enum(["refund", "discount", "accept_flagged"]);
export type FailurePolicy = z.infer<typeof FailurePolicy>;

export const Verdict = z.enum(["pass", "fail", "inconclusive"]);
export type Verdict = z.infer<typeof Verdict>;

export const AxisName = z.enum([
  "execution",
  "selection",
  "underwriting",
  "latency",
  "cost_honesty",
  "judgment",
]);
export type AxisName = z.infer<typeof AxisName>;

const unit = z.number().min(0).max(1);
const usd = z.number().min(0);

// ---------------------------------------------------------------------------
// §1 Request — the only entry point
// ---------------------------------------------------------------------------

export const Attachment = z.object({
  name: z.string().min(1),
  media_type: z.string().default("text/html"),
  /** Inline content. Small demo inputs only; blob storage is a later step. */
  content: z.string(),
});
export type Attachment = z.infer<typeof Attachment>;

export const DeclaredCheck = z.object({
  check_id: z.string().min(1),
  weight: z.number().min(0),
  description: z.string(),
});
export type DeclaredCheck = z.infer<typeof DeclaredCheck>;

export const VerificationSpec = z.object({
  rubric_version: z.string().min(1),
  checks: z.array(DeclaredCheck).min(1),
  required_passing: unit,
});
export type VerificationSpec = z.infer<typeof VerificationSpec>;

export const RequestTask = z.object({
  requirement: z.string().min(1),
  files: z.array(Attachment).default([]),
});

export const Request = z.object({
  request_id: z.string(),
  task: RequestTask,
  max_cost_usd: usd,
  max_latency_s: z.number().positive(),
  min_confidence: unit,
  failure_policy: FailurePolicy,
  selection_timeout_s: z.number().positive(),
  verification: VerificationSpec,
});
export type Request = z.infer<typeof Request>;

/**
 * What the buyer actually sends (the "4 + 1 fields"). Everything else has a
 * default so an agent can fire a request with four numbers and a file.
 */
export const RequestInput = z.object({
  task: RequestTask,
  max_cost_usd: usd,
  max_latency_s: z.number().positive(),
  min_confidence: unit,
  failure_policy: FailurePolicy.default("refund"),
  selection_timeout_s: z.number().positive().default(5),
  verification: VerificationSpec.optional(),
  /**
   * `seed` = Mastra auction loop (demoday). `push` = locked marketplace PoC
   * (invite → one plan+price → best-score → lock → deliver). Omit to follow
   * `MARKETPLACE_PUSH=1` on the API, otherwise seed.
   */
  execution_mode: z.enum(["seed", "push"]).optional(),
  /**
   * Push only. When set, invite these hireable agent ids instead of Top-K.
   * Unknown, disabled, judge, or wrong-specialty ids are skipped.
   */
  invite_agent_ids: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  /**
   * Marketplace specialty. Omit to use `html_to_pdf` (demo / Top-K). The
   * hosted-agent test area sets this from the owned agent's specialties.
   */
  category: z.string().trim().min(1).max(80).optional(),
});
export type RequestInput = z.infer<typeof RequestInput>;

export const ExecutionMode = z.enum(["seed", "push"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const RequestStatus = z.enum([
  "received",
  "auctioning",
  "planning",
  "contracting",
  "executing",
  "verifying",
  "escalated",
  "completed",
  "failed",
  "no_eligible_bid",
  "no_eligible_plan",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

// ---------------------------------------------------------------------------
// §2 Plan — the contract
// ---------------------------------------------------------------------------

export const ChainHop = z.object({
  agent_id: z.string(),
  role: AgentRole,
  subtask: z.string(),
  /**
   * The share this hop retains. Additive along the chain, so
   * Σ hop.cost_usd ≤ plan.max_cost_usd − overhead holds literally. What a hop
   * charges its parent is the sum of its own share and everything below it.
   */
  cost_usd: usd,
});
export type ChainHop = z.infer<typeof ChainHop>;

export const Plan = z.object({
  plan_id: z.string(),
  request_id: z.string(),
  agent_id: z.string(),
  /** Parent plan for sub-plans published by hops further down the chain. */
  parent_plan_id: z.string().nullable(),

  deliverable: z.string(),
  promised_confidence: unit,
  max_cost_usd: usd,
  est_latency_s: z.number().positive(),

  chain: z.array(ChainHop).min(1),
  rationale: z.string(),
  plan_cost_usd: usd,
  stake_usd: usd,

  strategy_considered: z.array(Strategy),
  strategy_chosen: Strategy,
});
export type Plan = z.infer<typeof Plan>;

export const PlanStatus = z.enum(["generated", "validated", "rejected"]);
export type PlanStatus = z.infer<typeof PlanStatus>;

/** Constraints a plan is validated against: the parent contract's budget/deadline/floor. */
export const PlanConstraints = z.object({
  max_cost_usd: usd,
  max_latency_s: z.number().positive(),
  min_confidence: unit,
  /** Agents already above this plan in the chain (cycle guard). */
  ancestors: z.array(z.string()),
});
export type PlanConstraints = z.infer<typeof PlanConstraints>;

/**
 * Seller-submitted plan on the push path. Single price — no reprice, no counter.
 * `steps` / `approach` become the rationale / deliverable prose.
 */
export const JobPlanInput = z.object({
  approach: z.string().optional(),
  steps: z.union([z.string(), z.array(z.string())]).optional(),
  price_usd: usd,
  promised_confidence: unit,
  max_latency_s: z.number().positive(),
  chain: z.array(ChainHop).optional(),
  deliverable: z.string().optional(),
  rationale: z.string().optional(),
});
export type JobPlanInput = z.infer<typeof JobPlanInput>;

/**
 * Worker-produced PDF. The platform inspects `pdf_base64` bytes — it does not
 * render or invent an artifact on the push path.
 */
export const JobDeliverableArtifact = z.object({
  pdf_base64: z.string().min(20),
  artifact_ref: z.string().min(1).optional(),
  kind: z.literal("pdf").optional(),
  observed_latency_ms: z.number().nonnegative().optional(),
  declared_latency_ms: z.number().nonnegative().optional(),
  self_report: unit.optional(),
});
export type JobDeliverableArtifact = z.infer<typeof JobDeliverableArtifact>;

/** Winner deliverable. `artifact.pdf_base64` is required. */
export const JobDeliverableInput = z.object({
  artifact: JobDeliverableArtifact,
  self_confidence: unit.optional(),
});
export type JobDeliverableInput = z.infer<typeof JobDeliverableInput>;

// ---------------------------------------------------------------------------
// §3 Bid — the auction (one round)
// ---------------------------------------------------------------------------

export const Bid = z.object({
  bid_id: z.string(),
  request_id: z.string(),
  agent_id: z.string(),
  confidence: unit,
  cost_usd: usd,
  latency_s: z.number().positive(),
  chain: z.array(ChainHop).min(1),
  rationale: z.string(),
  trust_global_snapshot: unit,
  counter_of: z.string().nullable(),
  strategy_chosen: Strategy,
});
export type Bid = z.infer<typeof Bid>;

// ---------------------------------------------------------------------------
// §4 Verification — verdict + confidence
// ---------------------------------------------------------------------------

export const Check = z.object({
  check_id: z.string(),
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
  weight: z.number().min(0),
});
export type Check = z.infer<typeof Check>;

export const ConfidenceMethod = z.literal("hardcoded_v0");

export const ConfidenceBreakdown = z.object({
  objective: unit.nullable(),
  agreement: unit.nullable(),
  track_record: unit.nullable(),
  process: unit.nullable(),
  self_report: unit.nullable(),
  computed: unit,
  method: ConfidenceMethod,
});
export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdown>;

export const JudgeVerdict = z.object({
  judge_id: z.string(),
  model_family: z.string(),
  verdict: Verdict,
  rubric_version: z.string(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export const Verification = z.object({
  verification_id: z.string(),
  request_id: z.string(),
  artifact_ref: z.string(),
  producer_agent_id: z.string(),
  checks: z.array(Check),
  confidence: ConfidenceBreakdown,
  verdict: Verdict,
  judges: z.array(JudgeVerdict),
  judges_disagree: z.boolean(),
});
export type Verification = z.infer<typeof Verification>;

// ---------------------------------------------------------------------------
// §5 LedgerEvent — append-only
// ---------------------------------------------------------------------------

export const LedgerEventType = z.enum([
  "request_received",
  "bid_submitted",
  "counter_offer",
  "auto_selected_by_timeout",
  "plan_generated",
  "plan_validated",
  "plan_rejected",
  "agent_hired",
  "task_delegated",
  "artifact_produced",
  "check_run",
  "judge_verdict",
  "escrow_held",
  "escrow_locked",
  "escrow_released",
  "escrow_withheld",
  "dispute_opened",
  "stake_posted",
  "stake_refunded",
  "stake_forfeited",
  "commission_charged",
  "wallet_updated",
  "escalated",
  "attribution_emitted",
  "axes_updated",
  "plan_request",
  "plan_selected",
]);
export type LedgerEventType = z.infer<typeof LedgerEventType>;

export const LedgerEvent = z.object({
  event_id: z.string(),
  seq: z.number().int(),
  ts: z.number(),
  request_id: z.string(),
  parent_event_id: z.string().nullable(),
  type: LedgerEventType,
  agent_id: z.string().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().min(0),
  tokens_out: z.number().int().min(0),
  cost_usd: usd,
  latency_ms: z.number().min(0),
  payload: z.record(z.string(), z.unknown()),
});
export type LedgerEvent = z.infer<typeof LedgerEvent>;

/** Derived from the ledger — never a parallel counter. */
export const LedgerMetrics = z.object({
  total_cost_usd: z.number(),
  tokens_in: z.number(),
  tokens_out: z.number(),
  cost_per_check_passed: z.number().nullable(),
  human_interventions: z.number().int(),
  handoffs: z.number().int(),
  checks_passed: z.number().int(),
  checks_total: z.number().int(),
  events: z.number().int(),
});
export type LedgerMetrics = z.infer<typeof LedgerMetrics>;

// ---------------------------------------------------------------------------
// §6 Escrow — state machine
// ---------------------------------------------------------------------------

export const EscrowStatus = z.enum([
  "CREATED",
  "LOCKED",
  "RELEASED",
  "WITHHELD",
  "ESCALATED",
  "REFUNDED",
  "DISPUTE",
]);
export type EscrowStatus = z.infer<typeof EscrowStatus>;

export const Escrow = z.object({
  escrow_id: z.string(),
  request_id: z.string(),
  plan_id: z.string(),
  hop_index: z.number().int().min(0),
  /** `null` payer means the buyer. */
  payer_agent_id: z.string().nullable(),
  payee_agent_id: z.string(),
  amount_usd: usd,
  stake_usd: usd,
  min_confidence: unit,
  status: EscrowStatus,
});
export type Escrow = z.infer<typeof Escrow>;

/** Legal transitions. Anything else is a bug, not a business case. */
export const ESCROW_TRANSITIONS: Record<EscrowStatus, readonly EscrowStatus[]> = {
  CREATED: ["LOCKED"],
  LOCKED: ["RELEASED", "WITHHELD"],
  WITHHELD: ["ESCALATED", "REFUNDED", "DISPUTE"],
  ESCALATED: ["LOCKED"],
  RELEASED: [],
  REFUNDED: [],
  DISPUTE: [],
};

// ---------------------------------------------------------------------------
// §7 Attribution — causal walk-back
// ---------------------------------------------------------------------------

export const RootCause = z.enum([
  "bad_execution",
  "bad_selection",
  "bad_underwriting",
  "spec_ambiguous",
]);
export type RootCause = z.infer<typeof RootCause>;

export const Attribution = z.object({
  attribution_id: z.string(),
  request_id: z.string(),
  failed_hop: z.string(),
  root_cause: RootCause,
  blamed_agent: z.string().nullable(),
  evidence_event_ids: z.array(z.string()),
  explanation: z.string(),
});
export type Attribution = z.infer<typeof Attribution>;

// ---------------------------------------------------------------------------
// §8 Axes
// ---------------------------------------------------------------------------

export const AxisVector = z.object({
  execution: unit.nullable(),
  selection: unit.nullable(),
  underwriting: unit.nullable(),
  latency: unit.nullable(),
  cost_honesty: unit.nullable(),
  judgment: unit.nullable(),
});
export type AxisVector = z.infer<typeof AxisVector>;

// ---------------------------------------------------------------------------
// §9 Registry manifest (ARCHITECTURE.md §9) + §10 Wallet
// ---------------------------------------------------------------------------

export const LatencyClass = z.enum(["fast", "mid", "slow"]);
export type LatencyClass = z.infer<typeof LatencyClass>;

export const RiskTolerance = z.enum(["low", "mid", "high"]);
export type RiskTolerance = z.infer<typeof RiskTolerance>;

export const AgentManifest = z.object({
  agent_id: z.string(),
  name: z.string(),
  role: AgentRole,
  specialties: z.array(z.string()),
  model_family: z.string(),
  /** Model id the agent routes inference to. `"auto"` = provider-side routing. */
  model: z.string(),
  baseline_confidence: unit,
  cost_ceiling_usd: usd,
  latency_class: LatencyClass,
  axes: AxisVector,
  risk_tolerance: RiskTolerance,
});
export type AgentManifest = z.infer<typeof AgentManifest>;

export const Wallet = z.object({
  owner_id: z.string(),
  capital_usd: z.number(),
  risk_tolerance: RiskTolerance,
});
export type Wallet = z.infer<typeof Wallet>;

export const BalanceSheet = z.object({
  agent_id: z.string(),
  capital_usd: z.number(),
  revenue_usd: z.number(),
  costs_usd: z.number(),
  profit_usd: z.number(),
  commissions_paid_usd: z.number(),
  bankrupt: z.boolean(),
});
export type BalanceSheet = z.infer<typeof BalanceSheet>;

/** System wallets that make money conservation (§9 invariant 11) checkable. */
export const SYSTEM_WALLETS = {
  buyer: "buyer",
  marketplace: "marketplace",
  provider: "inference_provider",
  /** Holds locked amounts and stakes between lock and settlement. */
  escrow: "escrow",
} as const;
