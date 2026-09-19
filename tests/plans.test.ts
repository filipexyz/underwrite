import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { RULES } from "@/lib/marketplace/context";
import { planFromQuote, validatePlan, type PlanDraft } from "@/lib/marketplace/plans";
import { buildQuote, priceToBuyer } from "@/lib/marketplace/quotes";
import { getAgent, loadRegistry, type Registry } from "@/lib/marketplace/registry";

let registry: Registry;

beforeAll(async () => {
  const { db } = await getDb();
  registry = await loadRegistry(db, TASK_CATEGORY);
});

function topQuote() {
  const a = getAgent(registry, "a-delegator");
  const quote = buildQuote(a, a.policy.prime!, 0.95, { registry, ancestors: [], exclude: new Set(), depth: 0 });
  if (!quote) throw new Error("A could not quote");
  return quote;
}

function topPlan(): PlanDraft {
  return planFromQuote({ request_id: "req_test", quote: topQuote(), parent_plan_id: null, plan_cost_usd: 0.001, deliverable: "PDF", rationale: "test" });
}

const constraints = { max_cost_usd: 0.05, max_latency_s: 30, min_confidence: 0.95, ancestors: [] };

describe("plan validation (the plan is the contract)", () => {
  it("A's seeded plan declares A → B → C1 and validates against the demo request", () => {
    const plan = topPlan();
    expect(plan.chain.map((h) => h.agent_id)).toEqual(["a-delegator", "b-mid", "c1-cheap"]);
    expect(plan.max_cost_usd).toBe(priceToBuyer(0.02));
    const result = validatePlan(plan, constraints, registry);
    expect(result.ok).toBe(true);
  });

  it("rejects a plan over budget, over deadline or under the confidence floor with exact reasons", () => {
    const plan = topPlan();
    const result = validatePlan(plan, { ...constraints, max_cost_usd: 0.01, max_latency_s: 5, min_confidence: 0.99 }, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.startsWith("budget"))).toBe(true);
      expect(result.reasons.some((r) => r.startsWith("deadline"))).toBe(true);
      expect(result.reasons.some((r) => r.startsWith("confidence"))).toBe(true);
    }
  });

  it("rejects cycles, unknown agents, and excessive depth", () => {
    const plan = topPlan();
    const cyclic: PlanDraft = { ...plan, chain: [...plan.chain, { agent_id: "a-delegator", role: "delegator", subtask: "again", cost_usd: 0 }] };
    const r1 = validatePlan(cyclic, constraints, registry);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reasons.some((r) => r.startsWith("no_cycles") || r.startsWith("depth"))).toBe(true);

    const unknown: PlanDraft = { ...plan, chain: [plan.chain[0], { ...plan.chain[1], agent_id: "ghost" }, plan.chain[2]] };
    const r2 = validatePlan(unknown, constraints, registry);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reasons.some((r) => r.startsWith("registry"))).toBe(true);

    const deep: PlanDraft = {
      ...plan,
      chain: [...plan.chain, { agent_id: "c2-honest", role: "executor", subtask: "x", cost_usd: 0.001 }, { agent_id: "j1-judge", role: "judge", subtask: "y", cost_usd: 0.001 }],
    };
    const r3 = validatePlan(deep, constraints, registry);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reasons.some((r) => r.startsWith("depth"))).toBe(true);
  });

  it("enforces Σ hop shares ≤ max_cost − overhead and a minimum overhead per delegating hop", () => {
    const plan = topPlan();
    const greedy: PlanDraft = { ...plan, chain: plan.chain.map((h) => ({ ...h, cost_usd: h.cost_usd * 2 })) };
    const r1 = validatePlan(greedy, constraints, registry);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reasons.some((r) => r.startsWith("conservation"))).toBe(true);

    const passThrough: PlanDraft = { ...plan, chain: plan.chain.map((h, i) => (i === 1 ? { ...h, cost_usd: 0 } : h)) };
    const r2 = validatePlan(passThrough, constraints, registry);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reasons.some((r) => r.startsWith("overhead"))).toBe(true);
  });

  it("B, hiring without history, picks the cheapest renderer; A, hiring with history, still picks B on trust", () => {
    const quote = topQuote();
    expect(quote.selection?.history_checked).toBe(true);
    expect(quote.selection?.chosen).toBe("b-mid");
    const sub = quote.sub!;
    expect(sub.selection?.history_checked).toBe(false);
    expect(sub.selection?.chosen).toBe("c1-cheap");
    expect(sub.selection?.price_vs_market).toBeLessThanOrEqual(-0.3);
    expect(quote.sub?.sub?.agent_id).toBe("c1-cheap");
    expect(RULES.MAX_DEPTH).toBe(2);
  });
});
