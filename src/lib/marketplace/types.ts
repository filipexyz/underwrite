/**
 * Engine-side types that are NOT wire contracts: how a seeded agent behaves.
 *
 * The catalog is data (ARCHITECTURE.md §9, D-007). Each agent row carries a
 * `policy` describing how it bids, whom it hires, and how it executes. The
 * engine interprets the policy; nothing about A/B/C1/C2 is hardcoded in code.
 */
import type { AgentRole, Strategy } from "@/lib/contracts";
import type { PdfArtifact } from "./artifact";
import type { Selection } from "./quotes";

export type SelectionPolicy = "cheapest" | "cheapest_trusted";

/** Declared token profile on an agent policy (quoting / cost honesty), not a simulation switch. */
export type TokenEstimate = { in: number; out: number };

export type QuotePolicy = {
  strategy: Strategy;
  /** Confidence this agent underwrites for the hop it is quoting. */
  promised_confidence: number;
  /** Time this hop adds on top of its subcontractors. */
  own_latency_s: number;
  /** Share this hop retains (its own work + margin). */
  own_cost_usd: number;
  /** For `decompose` / `outsource`: specialty it hires for. */
  subcontract_specialty?: string;
  subtask: string;
};

export type ExecutionPolicy = {
  /** Deterministic artifact outcome — the injected failure lives here (D-014). */
  quality: "clean" | "layout_overflow";
  /** Quoted render time the producer declared (SLA / cost honesty). */
  latency_s: number;
  /** Declared slack vs `latency_s`. Observed latency comes from the real render. */
  latency_jitter: number;
  /** What the producer claims after delivering. Capped, low weight, suspect. */
  self_report: number;
  tokens: TokenEstimate;
};

export type AgentPolicy = {
  /** Behaviour when bidding on a buyer request. `null` = subcontract-only. */
  prime: QuotePolicy | null;
  /**
   * Behaviour when hired as a subcontractor, keyed by the specialty being
   * bought (a full `html_to_pdf` job costs more than a `pdf_render` step).
   * `null` = never takes subcontracts.
   */
  sub: Record<string, QuotePolicy> | null;
  selection: {
    policy: SelectionPolicy;
    /** Whether it consults the registry history before hiring. */
    check_history: boolean;
    /** SLA it asks of its subcontractors: pass its own floor through, or a fixed (weaker) one. */
    floor_mode: "pass_through" | "fixed";
    fixed_floor?: number;
  };
  execution: ExecutionPolicy | null;
  /** Tokens burned when acting as a judge. `null` = not a judge. */
  judge: { tokens: TokenEstimate } | null;
  planning_tokens: TokenEstimate;
};

/** Per-model list price used to turn token usage into dollars. */
export type ModelPrice = { input_per_1m_usd: number; output_per_1m_usd: number };

/**
 * One contracted hop of the active chain. Index 0 is the buyer-facing agent.
 * Everything a settlement step needs is here, so steps stay stateless.
 */
export type HopRecord = {
  hop_index: number;
  agent_id: string;
  role: AgentRole;
  /** `null` = the buyer. */
  hirer_id: string | null;
  plan_id: string;
  escrow_id: string;
  /** Shares this hop charges its hirer (the buyer additionally pays the commission on the top hop). */
  price_usd: number;
  own_cost_usd: number;
  promised_confidence: number;
  /** SLA owed to the hirer. */
  floor: number;
  own_latency_s: number;
  est_latency_s: number;
  /** Deadline the hirer imposed on this hop (the `latency` axis measures slack against it). */
  deadline_s: number;
  strategy: Strategy;
  subtask: string;
  /** Specialty bought by the hirer (`html_to_pdf`, `pdf_render`, …). */
  specialty: string;
  /** Selection evidence recorded by the hirer when it picked this hop, if any. */
  selection: Selection | null;
};

export type VerificationCursor = {
  verification_id: string;
  objective: number | null;
  evidence_event_ids: string[];
};

/**
 * Engine state between workflow steps. Persisted on the request row; the
 * ledger remains the audit trail, this is just the cursor.
 */
export type EngineState = {
  bid_id: string | null;
  attempt: number;
  escalations: number;
  /** Quoted coordination time plus observed render time, against `max_latency_s`. */
  elapsed_s: number;
  /** Coordination time of hops contracted but not yet executed. */
  pending_latency_s: number;
  hops: HopRecord[];
  failed_agents: string[];
  artifact: PdfArtifact | null;
  artifact_event_id: string | null;
  render_cost_usd: number;
  verification: VerificationCursor | null;
  settled: boolean;
  /** `push` = locked marketplace PoC (invite → one plan → best-score). Default seed. */
  execution_mode?: "seed" | "push";
  invited_agent_ids?: string[];
  plan_deadline_at?: string | null;
  /** Buyer max reserved in the escrow wallet before a winner is chosen. */
  hold_usd?: number;
  selected_plan_id?: string | null;
};

export const EMPTY_STATE: EngineState = {
  bid_id: null,
  attempt: 0,
  escalations: 0,
  elapsed_s: 0,
  pending_latency_s: 0,
  hops: [],
  failed_agents: [],
  artifact: null,
  artifact_event_id: null,
  render_cost_usd: 0,
  verification: null,
  settled: false,
};
