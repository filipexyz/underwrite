/**
 * The demo scene, end to end, against an in-memory Postgres:
 * A wins → outsources to B → B hires C1 blind → C1 fails (≈41%) → escrows
 * withheld, B blamed → A escalates to C2 within budget → 96% → released.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import { getDb, type Db } from "@/lib/db/client";
import { trustPairwise, wallets } from "@/lib/db/schema";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { RULES } from "@/lib/marketplace/context";
import { createRequest, DEMO_REQUEST, getRequestDetail, type RequestDetail } from "@/lib/marketplace/requests";
import { runMarketplace } from "@/mastra";

let db: Db;
let detail: RequestDetail;
let capitalBefore: Map<string, number>;

async function capital(): Promise<Map<string, number>> {
  const rows = await db.select().from(wallets);
  return new Map(rows.map((r) => [r.ownerId, r.capitalUsd]));
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

beforeAll(async () => {
  ({ db } = await getDb());
  capitalBefore = await capital();
  const row = await createRequest(db, DEMO_REQUEST, { actor: "agent", source: "tests/loop" });
  const outcome = await runMarketplace(row.requestId);
  expect(outcome.status).toBe("success");
  const loaded = await getRequestDetail(db, row.requestId);
  if (!loaded) throw new Error("request vanished");
  detail = loaded;
});

describe("the marketplace loop settles the demo scene with zero human decisions", () => {
  it("completes after exactly one escalation with human_interventions = 0", () => {
    expect(detail.request.status).toBe("completed");
    expect(detail.request.completedAt).not.toBeNull();
    expect(detail.metrics.human_interventions).toBe(0);
    expect(detail.request.state?.escalations).toBe(1);
    expect(detail.request.state?.attempt).toBe(2);
  });

  it("emits a certificate for A → C2 that honours the 4 fields of the request", () => {
    const certificate = (detail.request.outcome as { certificate: Record<string, unknown> }).certificate;
    expect(certificate.chain).toEqual(["a-delegator", "c2-honest"]);
    expect(certificate.verdict).toBe("pass");
    expect(certificate.judges_agree).toBe(true);
    expect(certificate.delivered_confidence as number).toBeGreaterThanOrEqual(DEMO_REQUEST.min_confidence);
    expect(certificate.price_usd as number).toBeLessThanOrEqual(DEMO_REQUEST.max_cost_usd);
    expect(certificate.elapsed_s as number).toBeLessThanOrEqual(DEMO_REQUEST.max_latency_s);
  });

  it("verifies C1 at ≈41% (fail) and C2 at ≈96% (pass, judges agree)", () => {
    const [first, second] = detail.verifications;
    expect(detail.verifications).toHaveLength(2);

    expect(first.producerAgentId).toBe("c1-cheap");
    expect(first.verdict).toBe("fail");
    expect(first.confidence.computed).toBeGreaterThan(0.35);
    expect(first.confidence.computed).toBeLessThan(0.47);
    expect(first.confidence.self_report).toBeCloseTo(0.98, 2);
    expect(first.checks.filter((c) => !c.passed).map((c) => c.check_id)).toEqual(
      expect.arrayContaining(["no_layout_overflow", "text_matches_source"]),
    );

    expect(second.producerAgentId).toBe("c2-honest");
    expect(second.verdict).toBe("pass");
    expect(second.confidence.computed).toBeGreaterThanOrEqual(0.95);
    expect(second.judgesDisagree).toBe(false);
    expect(second.judges.map((j) => j.judge_id).sort()).toEqual(["j1-judge", "j2-judge"]);
    expect(second.checks.every((c) => c.passed)).toBe(true);
  });

  it("walks every escrow through the §6 state machine: failed chain WITHHELD → REFUNDED / ESCALATED, settled chain RELEASED", () => {
    const byPayee = new Map(detail.escrows.map((e) => [e.payeeAgentId, e]));
    expect(detail.escrows).toHaveLength(4);
    const withheld = detail.events.filter((e) => e.type === "escrow_withheld").map((e) => e.agent_id);
    expect(withheld).toEqual(["c1-cheap", "b-mid"]);

    // B → C1: withheld, then B's locked amount refunded (failure_policy = refund).
    expect(byPayee.get("c1-cheap")?.status).toBe("REFUNDED");
    expect(byPayee.get("c1-cheap")?.resolvedAt).not.toBeNull();
    // A → B: withheld, then unlocked so A could re-contract within its own budget.
    expect(byPayee.get("b-mid")?.status).toBe("ESCALATED");
    // The replacement hop and the top-level contract both settle.
    expect(byPayee.get("c2-honest")?.status).toBe("RELEASED");
    expect(byPayee.get("a-delegator")?.status).toBe("RELEASED");
    // `payer_agent_id = null` is the buyer (CONTRACTS.md §6).
    expect(byPayee.get("a-delegator")?.payerAgentId).toBeNull();
    expect(byPayee.get("a-delegator")?.resolvedAt).not.toBeNull();
  });

  it("orders the ledger: withhold → escalate → release, with contiguous seq and 4 handoffs", () => {
    const seqOf = (type: string, agent: string) => detail.events.find((e) => e.type === type && e.agent_id === agent)?.seq ?? -1;
    const withheldC1 = seqOf("escrow_withheld", "c1-cheap");
    const withheldB = seqOf("escrow_withheld", "b-mid");
    const attribution = seqOf("attribution_emitted", "b-mid");
    const escalated = seqOf("escalated", "a-delegator");
    const releasedC2 = seqOf("escrow_released", "c2-honest");
    const releasedA = seqOf("escrow_released", "a-delegator");

    expect(withheldC1).toBeGreaterThan(0);
    expect(withheldC1).toBeLessThan(withheldB);
    expect(withheldB).toBeLessThan(attribution);
    expect(attribution).toBeLessThan(escalated);
    expect(escalated).toBeLessThan(releasedC2);
    expect(releasedC2).toBeLessThan(releasedA);

    expect(detail.events.map((e) => e.seq)).toEqual(detail.events.map((_, i) => i + 1));
    expect(detail.events.filter((e) => e.type === "escrow_locked")).toHaveLength(4);
    expect(detail.metrics.handoffs).toBe(4);
    expect(detail.metrics.events).toBe(detail.events.length);
  });

  it("attributes the failure to B's selection, not C1's execution", () => {
    expect(detail.attributions).toHaveLength(1);
    const [attribution] = detail.attributions;
    expect(attribution.rootCause).toBe("bad_selection");
    expect(attribution.blamedAgent).toBe("b-mid");
    expect(attribution.failedHop).toBe("c1-cheap");
    expect(attribution.explanation).toContain("without consulting its history");
    expect(attribution.evidenceEventIds.length).toBeGreaterThan(0);
  });

  it("drops trust_pairwise(A,B) and trust_pairwise(B,C1) below the rehire threshold", async () => {
    const pair = async (from: string, to: string) => {
      const [row] = await db
        .select()
        .from(trustPairwise)
        .where(and(eq(trustPairwise.fromAgentId, from), eq(trustPairwise.toAgentId, to), eq(trustPairwise.category, TASK_CATEGORY)));
      return row;
    };
    const ab = await pair("a-delegator", "b-mid");
    const bc1 = await pair("b-mid", "c1-cheap");
    const ac2 = await pair("a-delegator", "c2-honest");
    expect(ab?.trust).toBeLessThan(RULES.PAIRWISE_MIN);
    expect(bc1?.trust).toBeLessThan(RULES.PAIRWISE_MIN);
    expect(ac2?.trust).toBeGreaterThanOrEqual(RULES.PAIRWISE_MIN);
  });

  it("conserves money: Σ wallet deltas = 0, escrow drains to 0, the buyer pays exactly the settled price", async () => {
    const after = await capital();
    expect(sum(after.values())).toBeCloseTo(sum(capitalBefore.values()), 6);

    const deltas = detail.events
      .filter((e) => e.type === "wallet_updated")
      .map((e) => e.payload.delta_usd as number);
    expect(sum(deltas)).toBeCloseTo(0, 6);
    expect(after.get(SYSTEM_WALLETS.escrow)).toBeCloseTo(0, 6);

    const certificate = (detail.request.outcome as { certificate: { price_usd: number } }).certificate;
    const buyerBefore = capitalBefore.get(SYSTEM_WALLETS.buyer) ?? 0;
    expect(buyerBefore - (after.get(SYSTEM_WALLETS.buyer) ?? 0)).toBeCloseTo(certificate.price_usd, 6);

    // Liars and blind hirers pay: C1 and B forfeited stakes to the marketplace.
    expect(after.get("c1-cheap") ?? 0).toBeLessThan(capitalBefore.get("c1-cheap") ?? 0);
    expect(after.get("b-mid") ?? 0).toBeLessThan(capitalBefore.get("b-mid") ?? 0);
    expect(after.get(SYSTEM_WALLETS.marketplace) ?? 0).toBeGreaterThan(capitalBefore.get(SYSTEM_WALLETS.marketplace) ?? 0);
  });

  it("remembers: the next request skips B and C1 entirely and settles on the first attempt", async () => {
    const row = await createRequest(db, DEMO_REQUEST, { actor: "agent", source: "tests/loop" });
    const outcome = await runMarketplace(row.requestId);
    expect(outcome.status).toBe("success");
    const second = await getRequestDetail(db, row.requestId);
    if (!second) throw new Error("request vanished");

    expect(second.request.status).toBe("completed");
    expect(second.request.state?.escalations).toBe(0);
    expect(second.request.state?.hops.map((h) => h.agent_id)).toEqual(["a-delegator", "c2-honest"]);
    expect(second.attributions).toHaveLength(0);
    expect(second.events.some((e) => e.agent_id === "b-mid" && e.type === "agent_hired")).toBe(false);
    expect(second.metrics.human_interventions).toBe(0);
  });

  it("prices every model call: tokens, model and dollars on each inference event", () => {
    const inference = detail.events.filter((e) => e.tokens_in + e.tokens_out > 0);
    expect(inference.length).toBeGreaterThanOrEqual(8);
    for (const e of inference) {
      expect(e.model).toBeTruthy();
      expect(e.cost_usd).toBeGreaterThan(0);
      expect(e.agent_id).toBeTruthy();
    }
    expect(detail.metrics.total_cost_usd).toBeCloseTo(sum(inference.map((e) => e.cost_usd)), 6);
    expect(detail.metrics.cost_per_check_passed).not.toBeNull();
  });
});
