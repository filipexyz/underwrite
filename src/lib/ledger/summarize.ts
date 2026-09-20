/**
 * One-line human summaries of ledger events, shared by the console and the CLI.
 */
import type { LedgerEvent } from "@/lib/contracts";

const chain = (hops: unknown) => (Array.isArray(hops) ? (hops as Array<{ agent_id: string }>).map((h) => h.agent_id).join(" → ") : "");
const finite = (n: unknown): number | undefined => {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
};
const usd = (n: unknown) => {
  const v = finite(n);
  return v === undefined ? "$—" : `$${v.toFixed(4)}`;
};
const pct = (n: unknown) => {
  const v = finite(n);
  return v === undefined ? "—%" : `${Math.round(v * 100)}%`;
};
const seconds = (n: unknown) => {
  const v = finite(n);
  return v === undefined ? "—" : `${v}s`;
};

export function summarizeEvent(e: Pick<LedgerEvent, "type" | "payload">): string {
  const p = e.payload;
  switch (e.type) {
    case "request_received":
      return `${p.requirement} · max ${usd(p.max_cost_usd)} · ≤ ${seconds(p.max_latency_s)} · min confidence ${pct(p.min_confidence)} · ${p.failure_policy} · actor ${p.actor}${p.execution_mode ? ` · ${p.execution_mode}` : ""}`;
    case "escrow_held":
      return `hold ${usd(p.amount_usd)} from ${p.payer} · ${p.status ?? "HELD"}`;
    case "plan_request":
      return `invite via ${p.channel} · deadline ${p.plan_deadline_at}`;
    case "plan_selected":
      return `${p.rule ?? "best-score"} · ${p.reason}${p.candidates && Array.isArray(p.candidates) ? ` · ${(p.candidates as unknown[]).length} plan(s)` : ""}`;
    case "bid_submitted":
      return `${p.compliant ? "compliant" : `non-compliant (${p.rejection_reason})`} · ${usd(p.cost_usd)} · confidence ${pct(p.confidence)} · ${seconds(p.latency_s)} · ${chain(p.chain)}`;
    case "agent_hired":
      return `hired by ${p.hirer}${p.selection ? ` — ${(p.selection as { rationale: string }).rationale}` : p.rule ? ` — ${p.rule}` : ""}`;
    case "task_delegated":
      return `${p.from} → ${p.to}: ${p.subtask} (floor ${pct(p.floor)}, ${usd(p.price_usd)}, ≤ ${Number(p.deadline_s).toFixed(1)}s)`;
    case "plan_generated": {
      const maxCost = finite(p.max_cost_usd) ?? finite(p.price_usd);
      const latency = finite(p.est_latency_s) ?? finite(p.max_latency_s);
      const strategy = typeof p.strategy_chosen === "string" && p.strategy_chosen ? p.strategy_chosen : "self";
      return `promised ${pct(p.promised_confidence)} · max ${usd(maxCost)} · ${seconds(latency)} · ${strategy} · ${chain(p.chain)}${p.supersedes_plan_id ? " · re-plan" : ""}`;
    }
    case "plan_validated":
      return "validated against declared constraints";
    case "plan_rejected":
      return `rejected: ${(p.reasons as string[] | undefined)?.join("; ")}`;
    case "escrow_locked":
      return `${p.payer} → ${p.payee} · ${usd(p.amount_usd)} · floor ${pct(p.min_confidence)}`;
    case "escrow_released":
      return `${p.payer} → ${p.payee} · ${usd(p.amount_usd)} · delivered ${pct(p.delivered_confidence)} ≥ floor ${pct(p.min_confidence)}`;
    case "escrow_withheld":
      return `${p.payer} → ${p.payee} · ${usd(p.amount_usd)} · promised ${pct(p.promised_confidence)}, delivered ${pct(p.delivered_confidence)} < floor ${pct(p.min_confidence)}`;
    case "stake_posted":
      return `stake ${usd(p.stake_usd)} on a promise of ${pct(p.promised_confidence)}`;
    case "stake_refunded":
      return `stake ${usd(p.stake_usd)} back — promise ${pct(p.promised_confidence)} met with ${pct(p.delivered_confidence)}`;
    case "stake_forfeited":
      return `stake ${usd(p.stake_usd)} forfeited — promised ${pct(p.promised_confidence)}, delivered ${pct(p.delivered_confidence)}`;
    case "commission_charged":
      return `${usd(p.commission_usd)} on ${usd(p.settled_price_usd)}`;
    case "wallet_updated":
      return `${p.owner_id} ${Number(p.delta_usd) >= 0 ? "+" : "−"}${usd(Math.abs(Number(p.delta_usd)))} → ${usd(p.balance_after)} (${p.reason})`;
    case "artifact_produced":
      return `${p.artifact_ref} · ${p.pages} page(s) · ${p.observed_latency_ms}ms · self-report ${pct(p.self_report)} (suspect)`;
    case "check_run":
      return `${p.passed ? "PASS" : "FAIL"} ${p.check_id} — ${p.detail}`;
    case "judge_verdict":
      return `${String(p.verdict).toUpperCase()} · ${p.model_family} · ${p.rationale}`;
    case "escalated":
      return `${p.from} → ${p.to} · ${usd(p.remaining_budget_usd)} and ${Number(p.remaining_deadline_s).toFixed(1)}s left · margin ${usd(p.hirer_margin_before_usd)} → ${usd(p.hirer_margin_after_usd)}`;
    case "attribution_emitted":
      return `${p.root_cause} → ${p.blamed_agent ?? "nobody"}: ${p.explanation}`;
    case "axes_updated":
      if (p.kind === "trust_pairwise") return `trust_pairwise(${p.from}, ${p.to}): ${p.before ?? "—"} → ${p.after}`;
      return `${p.reason}: ${Object.entries((p.samples as Record<string, number>) ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`;
    default:
      return "";
  }
}
