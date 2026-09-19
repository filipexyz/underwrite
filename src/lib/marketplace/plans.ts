/**
 * The plan is the contract (CONTRACTS.md §2, D-016/D-020/D-021).
 *
 * `validatePlan` is the "approval": automatic, against constraints already
 * declared — never a human, never a negotiation. Failure yields the exact
 * reason so the agent can reformulate within budget.
 */
import type { Plan, PlanConstraints } from "@/lib/contracts";
import { newId } from "@/lib/ids";
import { RULES } from "./context";
import { commissionOf, flattenChain, priceToBuyer, round6, stakeFor, type Quote } from "./quotes";
import type { Registry } from "./registry";

export type PlanDraft = Plan & { is_top: boolean };

export function planFromQuote(args: {
  request_id: string;
  quote: Quote;
  parent_plan_id: string | null;
  plan_cost_usd: number;
  deliverable: string;
  rationale: string;
}): PlanDraft {
  const isTop = args.parent_plan_id === null;
  const maxCost = isTop ? priceToBuyer(args.quote.price_usd) : args.quote.price_usd;
  return {
    plan_id: newId("plan"),
    request_id: args.request_id,
    agent_id: args.quote.agent_id,
    parent_plan_id: args.parent_plan_id,
    deliverable: args.deliverable,
    promised_confidence: args.quote.promised_confidence,
    max_cost_usd: maxCost,
    est_latency_s: args.quote.latency_s,
    chain: flattenChain(args.quote),
    rationale: args.rationale,
    plan_cost_usd: round6(args.plan_cost_usd),
    stake_usd: stakeFor(maxCost),
    strategy_considered: args.quote.strategy_considered,
    strategy_chosen: args.quote.strategy,
    is_top: isTop,
  };
}

export type PlanValidation = { ok: true; checks: string[] } | { ok: false; reasons: string[]; checks: string[] };

const EPS = 1e-9;

export function validatePlan(plan: PlanDraft, constraints: PlanConstraints, registry: Registry): PlanValidation {
  const reasons: string[] = [];
  const checks: string[] = [];

  const check = (name: string, ok: boolean, detail: string) => {
    checks.push(`${ok ? "ok" : "FAIL"} ${name}: ${detail}`);
    if (!ok) reasons.push(`${name}: ${detail}`);
  };

  check(
    "budget",
    plan.max_cost_usd <= constraints.max_cost_usd + EPS,
    `declared $${plan.max_cost_usd} ≤ $${constraints.max_cost_usd}`,
  );
  check(
    "deadline",
    plan.est_latency_s <= constraints.max_latency_s + EPS,
    `declared ${plan.est_latency_s}s ≤ ${constraints.max_latency_s}s`,
  );
  check(
    "confidence",
    plan.promised_confidence >= constraints.min_confidence - EPS,
    `promised ${plan.promised_confidence} ≥ ${constraints.min_confidence}`,
  );

  const unknown = plan.chain.filter((h) => !registry.agents.has(h.agent_id)).map((h) => h.agent_id);
  check("registry", unknown.length === 0, unknown.length ? `unknown agents: ${unknown.join(", ")}` : "every hop is registered");

  const ids = plan.chain.map((h) => h.agent_id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const cyclic = ids.filter((id) => constraints.ancestors.includes(id));
  check(
    "no_cycles",
    dupes.length === 0 && cyclic.length === 0,
    dupes.length || cyclic.length ? `repeated or ancestral agents: ${[...dupes, ...cyclic].join(", ")}` : "chain is acyclic",
  );

  const depth = plan.chain.length - 1;
  check(
    "depth",
    depth <= RULES.MAX_DEPTH && plan.chain.length <= RULES.MAX_HOPS,
    `depth ${depth} ≤ ${RULES.MAX_DEPTH}, hops ${plan.chain.length} ≤ ${RULES.MAX_HOPS}`,
  );

  const shares = round6(plan.chain.reduce((sum, h) => sum + h.cost_usd, 0));
  const overhead = plan.is_top ? commissionOf(plan.max_cost_usd) : 0;
  check(
    "conservation",
    shares <= round6(plan.max_cost_usd - overhead) + EPS,
    `Σ hop shares $${shares} ≤ $${plan.max_cost_usd} − overhead $${overhead}`,
  );

  const thinHops = plan.chain.slice(0, -1).filter((h) => h.cost_usd < RULES.MIN_OVERHEAD_USD);
  check(
    "overhead",
    thinHops.length === 0,
    thinHops.length
      ? `hops passing the whole budget down: ${thinHops.map((h) => h.agent_id).join(", ")}`
      : `every delegating hop retains ≥ $${RULES.MIN_OVERHEAD_USD}`,
  );

  return reasons.length === 0 ? { ok: true, checks } : { ok: false, reasons, checks };
}
