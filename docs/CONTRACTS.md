# CONTRACTS — Underwrite

The data contracts that let 5 people code in parallel without talking to each other.
Stack-agnostic: valid for TS, Python, Go. Freeze this and everything else can diverge.

Rules: vocabulary in English (code). Append-only. Every event carries `request_id`.

---

## 1. The product boundary: `Request`

This is **the only entry point** of the system. A human fills it via the console, an agent sends it
over MCP — same shape, same endpoint.

```ts
type Request = {
  request_id: string;
  task: {
    requirement: string;        // natural language
    files: Attachment[];        // optional
  };
  max_cost_usd: number;         // budget
  max_latency_s: number;        // deadline
  min_confidence: number;       // 0..1 — the SLA
  failure_policy: "refund" | "discount" | "accept_flagged";
  selection_timeout_s: number;  // after this, the buyer auto-selects (D-029)
  verification: VerificationSpec;  // the rubric SHIPS WITH THE TASK (D-031)
  // Buyer input extras (not on the stored Request row as first-class columns):
  // execution_mode?: "seed" | "push"
  // invite_agent_ids?: string[]   // push only — pin the invite set instead of Top-K
  // category?: string             // marketplace specialty; omit = html_to_pdf
};

// Declared up front, machine-readable, versioned. An agent cannot bid honestly on a
// confidence SLA without knowing what will be checked — so nothing here is hidden.
type VerificationSpec = {
  rubric_version: string;
  checks: DeclaredCheck[];      // categories, not the hidden samples
  required_passing: number;     // 0..1 weighted threshold
};

type DeclaredCheck = {
  check_id: string;             // "no_layout_overflow"
  weight: number;
  description: string;          // what it verifies, in prose
};
```

`failure_policy` was not in Xato's list and is mandatory — without it there is no escrow.
`verification` is D-031: anti-gaming comes from rotating *instances* inside declared categories, not
from hiding the criteria.

---

## 2. `Plan` — the contract

5 declarations. Published **before** execution. Chain is mandatory (D-020).

```ts
type Plan = {
  plan_id: string;
  request_id: string;
  agent_id: string;

  deliverable: string;          // "PDF A4, 2cm margins, 3 pages, fonts embedded"
  promised_confidence: number;  // 0..1
  max_cost_usd: number;
  est_latency_s: number;

  chain: ChainHop[];            // who executes, declared. Not the "how".
  rationale: string;
  plan_cost_usd: number;        // planning costs tokens too (D-021)
  stake_usd: number;            // forfeited only if it blows its own promise (D-028)

  strategy_considered: ("self" | "decompose" | "outsource")[];  // Suhuai's 3 options, D-030
  strategy_chosen: "self" | "decompose" | "outsource";
};

type ChainHop = {
  agent_id: string;
  role: "delegator" | "intermediary" | "executor" | "judge";
  subtask: string;
  cost_usd: number;             // what this hop charges its parent
};
```

> **Declares `who` and `how much`. Never the `how`.** Prompt, splitting strategy and internal order
> are the executor's freedom.

**Automatic validation** (this is the "approval" — no human, no negotiation):

| Check | Rule |
|-------|------|
| `plan.max_cost_usd` | ≤ `request.max_cost_usd` |
| `plan.est_latency_s` | ≤ `request.max_latency_s` |
| `plan.promised_confidence` | ≥ `request.min_confidence` |
| `chain` | every `agent_id` exists in the registry |
| `chain` | no cycles, depth ≤ 2, ≤ 4 hops |
| `chain` | Σ `hop.cost_usd` ≤ `plan.max_cost_usd` − overhead |

Failed → `PLAN_REJECTED` with the exact reason. The agent reformulates within budget.

---

## 3. `Bid` — the auction (one round)

```ts
type Bid = {
  bid_id: string;
  request_id: string;
  agent_id: string;
  confidence: number;           // promised
  cost_usd: number;
  latency_s: number;
  chain: ChainHop[];
  rationale: string;            // the "argumentation" — displayed and logged
  trust_global_snapshot: number;

  counter_of: string | null;    // set when this bid is a counter-offer (D-026)
  strategy_chosen: "self" | "decompose" | "outsource";
};
```

**Selection:** cheapest bid satisfying `confidence ≥ min_confidence` AND `latency_s ≤ max_latency_s`.
Tie → higher `confidence`. Second tie → higher `trust_global`.

**Negotiation, bounded (D-026):** the buyer may issue **at most one counter-offer** to one bidder.
That's the entire negotiation protocol — two messages per pair, then it's over. No third message, no
multi-round haggling.

**Timeout (D-029):** if the buyer doesn't pick within `selection_timeout_s`, the cheapest compliant
bid is selected and logged as `auto_selected_by_timeout`.

---

## 4. `Verification` — verdict + confidence

```ts
type Verification = {
  verification_id: string;
  request_id: string;
  artifact_ref: string;

  checks: Check[];              // ground truth, where it exists
  confidence: ConfidenceBreakdown;

  verdict: "pass" | "fail" | "inconclusive";
  judges: JudgeVerdict[];       // J1, J2 — only used when checks are inconclusive
  judges_disagree: boolean;
};

type Check = {
  check_id: string;
  name: string;                 // "pdf_valid", "text_matches_source", "no_layout_overflow"
  passed: boolean;
  detail: string;
};

type ConfidenceBreakdown = {
  objective: number | null;     // deterministic checks
  agreement: number | null;     // agreement across independent samples
  track_record: number | null;  // agent history in the category
  process: number | null;       // retries, cost, latency anomalies
  self_report: number | null;   // low, capped weight — evidence, not a score
  computed: number;             // 0..1
  method: "hardcoded_v0";       // always version the method
};

type JudgeVerdict = {
  judge_id: string;
  model_family: string;         // ≠ producer's family, mandatory
  verdict: "pass" | "fail" | "inconclusive";
  rubric_version: string;
};
```

**Rules:** checks take precedence over judges. `judges_disagree = true` → **SLA not met**,
regardless of individual verdicts. Conservative on purpose (D-017).

---

## 5. `LedgerEvent` — append-only

One row per event. It is the basis of the economy prize, the causal walk-back and the live screen.

```ts
type LedgerEvent = {
  ts: number;                   // monotonic
  request_id: string;
  parent_event_id: string | null;
  type: LedgerEventType;
  agent_id: string | null;
  model: string | null;         // "auto" when routed
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  payload: Record<string, unknown>;
};

type LedgerEventType =
  | "request_received"
  | "bid_submitted"
  | "counter_offer"            // at most one per pair (D-026)
  | "auto_selected_by_timeout"  // D-029
  | "plan_generated"       // costs tokens
  | "plan_validated"
  | "plan_rejected"
  | "agent_hired"
  | "task_delegated"
  | "artifact_produced"
  | "check_run"
  | "judge_verdict"
  | "escrow_locked"
  | "escrow_released"
  | "escrow_withheld"
  | "dispute_opened"
  | "stake_posted"
  | "stake_refunded"
  | "stake_forfeited"        // promised 98%, delivered 41% (D-028)
  | "commission_charged"
  | "wallet_updated"
  | "escalated"
  | "attribution_emitted"
  | "axes_updated";
```

Derived metrics (must come from the ledger, not a parallel counter):
`total_cost_usd`, `cost_per_check_passed`, `human_interventions` (must be 0 after the request),
`handoffs`, `tokens_per_successful_delivery`, `baseline_cost_usd` (everything on the bigger model).

---

## 6. `Escrow` — state machine

```
CREATED ──plan_validated──► LOCKED ──stake_posted──► (stake escrowed too)
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼
   RELEASED             WITHHELD
   (verdict pass &      (verdict fail, or
    confidence ≥ SLA)    judges_disagree)
        │                    │
        │        ┌───────────┴───────────┐
        │        ▼                       ▼
        │   ESCALATED                 REFUNDED
        │   (budget remains)   (budget exhausted)
        │        │                  → failure_policy
        │        └──► LOCKED (new executor)
        │
        └──► DISPUTE  (producer contests the verdict)
              → human auditor reads the log. Only path with a human,
                and it exists to be provably rare.
```

**Hard rule:** the producer is paid **only** when `verdict = pass` **and**
`confidence ≥ min_confidence`. There is no partial payment for "effort". There is no "almost".

**Stake settlement (D-028):** refunded when the producer meets its own promised confidence,
even if it loses the bid. **Forfeited when it blows its own promise.** Fulfilled stake → back to the
wallet; forfeited stake → `commission_charged`.

---

## 7. `Attribution` — causal walk-back

```ts
type Attribution = {
  attribution_id: string;
  request_id: string;
  failed_hop: string;           // where the failure showed up (e.g. "c1-cheap")
  root_cause:
    | "bad_execution"           // the executor delivered badly, knowing it
    | "bad_selection"           // the parent chose badly (ignored history/price)
    | "bad_underwriting"        // promised confidence the chain couldn't sustain
    | "spec_ambiguous";         // the request's fault — penalizes nobody
  blamed_agent: string | null;  // null when spec_ambiguous
  evidence_event_ids: string[];
  explanation: string;          // 1-2 sentences, goes on screen
};
```

**Anti-sandbagging rule:** `spec_ambiguous` → `blamed_agent = null` and **no axis is penalized**.
Without this, agents learn to always declare low confidence and the market dies.

**Penalty ladder** (the further away, the smaller the direct penalty — but never zero for whoever
made the decision):

| Cause | Penalizes | Axis |
|-------|-----------|------|
| `bad_execution` | the executor | `execution` |
| `bad_selection` | whoever hired | `selection` |
| `bad_underwriting` | whoever promised | `underwriting` |
| `spec_ambiguous` | nobody | — |

---

## 8. Axes — deterministic initial values

Start hardcoded (D-006), recalibrate with real outcomes. No ML on Saturday.

```
execution      = checks_passed_weighted / checks_total_weighted   (EMA, α=0.3)
selection      = 1 − failures_attributed_to_me_for_bad_selection
underwriting   = clamp(delivered_confidence / max(promised_confidence, ε), 0, 1)
latency        = 1 − clamp(observed_latency / promised_deadline, 0, 1)
cost_honesty   = 1 − clamp(observed_cost / promised_budget, 0, 1)
judgment       = 1 − my_verdicts_overturned_on_walkback / my_total_verdicts
```

**Progress guarantee:** every agent starts with a capped `w_self_report = 0.10`, and the weight of
`objective` grows as a task category accumulates checks. Record `method` in every
`ConfidenceBreakdown` — otherwise we can't compare runs from different versions mid-day.

---

## 9. Invariants (tests worth writing)

1. No ledger event with a nonexistent `request_id`.
2. `Σ request costs` == sum of `LedgerEvent.cost_usd`. No phantom cost.
3. `plan.chain` as declared == chain observed in the ledger. Divergence is a severe
   `underwriting` failure.
4. Escrow is never `RELEASED` without `confidence ≥ min_confidence`.
5. `human_interventions == 0` after `request_received`.
6. No cycles in the chain; depth ≤ 2.
7. A judge never has the same `model_family` as the producer it judges.
8. `spec_ambiguous` never produces an axis penalty.
9. No bidder sends more than one `counter_offer` for the same request.
10. A `stake_forfeited` never happens without a `underwriting` divergence above threshold.
11. `Σ wallet deltas` across all agents == 0 (money is conserved). Commission is a wallet too.

---

## 10. `Wallet` — agents are businesses

D-025. Without a balance sheet, Challenge 01 is cosmetic.

```ts
// in the registry manifest
type Wallet = {
  agent_id: string;
  capital_usd: number;          // current balance
  risk_tolerance: "low" | "mid" | "high";  // affects which tasks it accepts
};

// derived from the ledger, never stored twice
type BalanceSheet = {
  agent_id: string;
  capital_usd: number;
  revenue_usd: number;          // settled payments received
  costs_usd: number;            // inference + what it paid subcontractors + forfeited stakes
  profit_usd: number;
  commissions_paid_usd: number;
  bankrupt: boolean;            // capital <= 0 → the agent stops bidding
};
```

**Consequence worth showing on screen:** an agent that keeps accepting unprofitable work goes
bankrupt. Nothing in the code says "do not accept unprofitable work" — the market says it.

---

## 11. Simulator — emergent structure (D-027)

Run the whole engine N times (50–100) and emit aggregate metrics. No new subsystem: it's a loop.

```ts
type SimulationReport = {
  runs: number;
  market_concentration: number;        // share of volume of the top agent
  avg_agent_profit_usd: Record<string, number>;
  bankruptcies: string[];              // agent ids that hit zero
  avg_reputation: Record<string, number>;
  transaction_volume_usd: number;
  max_delegation_depth: number;
  price_evolution: { run: number; avg_price_usd: number }[];
  contract_failures: number;
  checks_passed_rate: number;
};
```

**This is the pitch.** Not "we built a marketplace" but *"we built a sandbox and here is the
structure that emerged"*. Nobody programmed a monopoly — if one forms, it formed.

**It is also the fallback.** If the live single transaction stalls on stage, the batch report is
already computed and the story survives.
