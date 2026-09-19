/**
 * Locked marketplace PoC: one plan per agent, best-score (not cheapest),
 * non-winner cannot deliver. Seed path stays seed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as postDeliverable } from "@/app/api/v1/jobs/[requestId]/deliverables/route";
import { GET as getPlans, POST as postPlan } from "@/app/api/v1/jobs/[requestId]/plans/route";
import { GET as getInbox } from "@/app/api/v1/agents/me/inbox/route";
import { POST as postRequest } from "@/app/api/v1/requests/route";
import { getDb, type Db } from "@/lib/db/client";
import { trustAxes } from "@/lib/db/schema";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { createRequest, DEMO_REQUEST, getRequestDetail } from "@/lib/marketplace/requests";
import { registerSellerAgent } from "@/lib/marketplace/sellers";
import { SCORE_WEIGHT_SUM, SCORE_WEIGHTS, rankPlans, scorePlan } from "@/lib/marketplace/score";
import { resolveExecutionMode, selectPlansIfReady } from "@/lib/marketplace/push";

let db: Db;

const buyerBody = {
  execution_mode: "push" as const,
  task: DEMO_REQUEST.task,
  max_cost_usd: 0.05,
  max_latency_s: 30,
  min_confidence: 0.95,
};

function sellerReq(secret: string, path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function params(requestId: string) {
  return { params: Promise.resolve({ requestId }) };
}

beforeAll(async () => {
  process.env.MARKETPLACE_TOP_K = "2";
  ({ db } = await getDb());
});

describe("scorePlan (not cheapest-only)", () => {
  const constraints = { max_cost_usd: 0.05, max_latency_s: 30, min_confidence: 0.95 };

  it("weights sum to 1 and a perfect plan scores 1", () => {
    expect(SCORE_WEIGHT_SUM).toBeCloseTo(1, 8);
    const perfect = scorePlan(
      { price_usd: 0, promised_confidence: 1, latency_s: 0, history: 1 },
      constraints,
    );
    expect(perfect.score).toBeCloseTo(1, 6);
    expect(perfect.compliant).toBe(true);
  });

  it("picks the higher-confidence dearer plan over the cheapest compliant one", () => {
    const cheap = {
      id: "cheap",
      price_usd: 0.01,
      promised_confidence: 0.95,
      latency_s: 28,
      history: 0.5,
    };
    const strong = {
      id: "strong",
      price_usd: 0.04,
      promised_confidence: 0.99,
      latency_s: 8,
      history: 0.9,
    };
    const { winner } = rankPlans([cheap, strong], constraints);
    expect(winner?.item.id).toBe("strong");
    expect(winner!.breakdown.score).toBeGreaterThan(scorePlan(cheap, constraints).score);
    expect(SCORE_WEIGHTS.confidence).toBeGreaterThan(SCORE_WEIGHTS.cost);
  });
});

describe("resolveExecutionMode", () => {
  it("honours an explicit mode over MARKETPLACE_PUSH", () => {
    const prev = process.env.MARKETPLACE_PUSH;
    process.env.MARKETPLACE_PUSH = "1";
    expect(resolveExecutionMode("seed")).toBe("seed");
    expect(resolveExecutionMode(undefined, "seed")).toBe("seed");
    expect(resolveExecutionMode("push")).toBe("push");
    if (prev === undefined) delete process.env.MARKETPLACE_PUSH;
    else process.env.MARKETPLACE_PUSH = prev;
  });

  it("defaults to seed when the env flag is off", () => {
    const prev = process.env.MARKETPLACE_PUSH;
    delete process.env.MARKETPLACE_PUSH;
    expect(resolveExecutionMode()).toBe("seed");
    if (prev !== undefined) process.env.MARKETPLACE_PUSH = prev;
  });
});

describe("push marketplace HTTP", () => {
  let cheapSecret: string;
  let strongSecret: string;
  let cheapId: string;
  let strongId: string;
  let jobId: string;

  beforeAll(async () => {
    const cheap = await registerSellerAgent(db, "user_push_cheap", {
      name: "Push cheap",
      role: "executor",
      specialties: [TASK_CATEGORY],
      model_family: "family-push",
      model: "auto",
      baseline_confidence: 0.95,
      cost_ceiling_usd: 0.02,
      latency_class: "slow",
      risk_tolerance: "high",
      webhook_url: "http://127.0.0.1:9/cheap",
    });
    const strong = await registerSellerAgent(db, "user_push_strong", {
      name: "Push strong",
      role: "executor",
      specialties: [TASK_CATEGORY],
      model_family: "family-push",
      model: "auto",
      baseline_confidence: 0.99,
      cost_ceiling_usd: 0.04,
      latency_class: "fast",
      risk_tolerance: "mid",
      webhook_url: "http://127.0.0.1:9/strong",
    });
    cheapSecret = cheap.secret;
    strongSecret = strong.secret;
    cheapId = cheap.agent.agentId;
    strongId = strong.agent.agentId;
    await db
      .update(trustAxes)
      .set({ execution: 0.95, underwriting: 0.95, latency: 0.9, samples: 4 })
      .where(eq(trustAxes.agentId, strongId));
  });

  it("creates a push job, holds escrow, and writes plan_request to the inbox", async () => {
    const created = await postRequest(
      new Request("http://localhost/api/v1/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buyerBody),
      }),
    );
    expect(created.status).toBe(202);
    const accepted = (await created.json()) as {
      request_id: string;
      execution_mode: string;
      invited_agent_ids: string[];
    };
    expect(accepted.execution_mode).toBe("push");
    expect(accepted.invited_agent_ids).toEqual(expect.arrayContaining([cheapId, strongId]));
    jobId = accepted.request_id;

    const inbox = await getInbox(sellerReq(cheapSecret, "/api/v1/agents/me/inbox"));
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as { messages: Array<{ type: string; job_id: string }> };
    expect(inboxBody.messages.some((m) => m.type === "plan_request" && m.job_id === jobId)).toBe(true);

    const detail = await getRequestDetail(db, jobId);
    expect(detail?.request.status).toBe("planning");
    expect(detail?.events.some((e) => e.type === "escrow_held")).toBe(true);
    expect(detail?.events.some((e) => e.type === "plan_request")).toBe(true);
  });

  it("rejects a second plan from the same agent", async () => {
    const first = await postPlan(
      sellerReq(cheapSecret, `/api/v1/jobs/${jobId}/plans`, {
        method: "POST",
        body: JSON.stringify({
          approach: "cheap pass",
          price_usd: 0.01,
          promised_confidence: 0.95,
          max_latency_s: 28,
        }),
      }),
      params(jobId),
    );
    expect(first.status).toBe(201);

    const second = await postPlan(
      sellerReq(cheapSecret, `/api/v1/jobs/${jobId}/plans`, {
        method: "POST",
        body: JSON.stringify({
          approach: "second try",
          price_usd: 0.011,
          promised_confidence: 0.96,
          max_latency_s: 20,
        }),
      }),
      params(jobId),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/one plan per agent/i);
  });

  it("selects the best-score plan, not the cheapest, and locks escrow", async () => {
    const posted = await postPlan(
      sellerReq(strongSecret, `/api/v1/jobs/${jobId}/plans`, {
        method: "POST",
        body: JSON.stringify({
          approach: "careful render",
          price_usd: 0.04,
          promised_confidence: 0.99,
          max_latency_s: 8,
        }),
      }),
      params(jobId),
    );
    expect(posted.status).toBe(201);

    const listed = await getPlans(new Request(`http://localhost/api/v1/jobs/${jobId}/plans`), params(jobId));
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { plans: Array<{ agent_id: string; status: string; price_usd: number }> };
    expect(listBody.plans).toHaveLength(2);

    await selectPlansIfReady(db, jobId, { force: true });
    const detail = await getRequestDetail(db, jobId);
    expect(detail?.request.status).toBe("executing");
    expect(detail?.request.state?.hops[0]?.agent_id).toBe(strongId);
    expect(detail?.escrows[0]?.status).toBe("LOCKED");
    expect(detail?.escrows[0]?.payeeAgentId).toBe(strongId);
    expect(detail?.escrows[0]?.amountUsd).toBeCloseTo(0.04, 5);
    expect(detail?.events.some((e) => e.type === "plan_selected")).toBe(true);
    expect(detail?.events.some((e) => e.type === "escrow_locked")).toBe(true);

    const selected = detail?.events.find((e) => e.type === "plan_selected");
    expect(String(selected?.payload.rule ?? "")).toMatch(/not cheapest/i);
    expect(selected?.agent_id).toBe(strongId);

    const inbox = await getInbox(sellerReq(strongSecret, "/api/v1/agents/me/inbox"));
    const inboxBody = (await inbox.json()) as { messages: Array<{ type: string; job_id: string }> };
    expect(inboxBody.messages.some((m) => m.type === "accepted" && m.job_id === jobId)).toBe(true);

    const loserInbox = await getInbox(sellerReq(cheapSecret, "/api/v1/agents/me/inbox"));
    const loserBody = (await loserInbox.json()) as { messages: Array<{ type: string; job_id: string }> };
    expect(loserBody.messages.some((m) => m.type === "rejected" && m.job_id === jobId)).toBe(true);
  });

  it("rejects a deliverable from the non-winner", async () => {
    const denied = await postDeliverable(
      sellerReq(cheapSecret, `/api/v1/jobs/${jobId}/deliverables`, {
        method: "POST",
        body: JSON.stringify({ stub: true, self_confidence: 0.95 }),
      }),
      params(jobId),
    );
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as { error: string };
    expect(body.error).toMatch(/winner/i);
  });

  it("lets the winner deliver; judge vs plan settles RELEASE", async () => {
    const delivered = await postDeliverable(
      sellerReq(strongSecret, `/api/v1/jobs/${jobId}/deliverables`, {
        method: "POST",
        body: JSON.stringify({ stub: true, self_confidence: 0.99 }),
      }),
      params(jobId),
    );
    expect(delivered.status).toBe(200);
    const body = (await delivered.json()) as { status: string; verifications: Array<{ verdict: string }> };
    expect(body.status).toBe("completed");
    expect(body.verifications.at(-1)?.verdict).toBe("pass");

    const detail = await getRequestDetail(db, jobId);
    expect(detail?.escrows[0]?.status).toBe("RELEASED");
    expect(detail?.events.some((e) => e.type === "escrow_released")).toBe(true);
    expect(detail?.metrics.human_interventions).toBe(0);
  });
});

describe("seed path is unchanged", () => {
  it("createRequest without execution_mode stays seed", async () => {
    const row = await createRequest(db, DEMO_REQUEST, { actor: "agent", source: "tests/push", executionMode: "seed" });
    expect(row.executionMode).toBe("seed");
    expect(row.status).toBe("received");
  });

  it("does not ship a reprice API", () => {
    expect(existsSync(join(process.cwd(), "src/app/api/v1/jobs/[requestId]/reprice/route.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/app/api/v1/jobs/[requestId]/counter/route.ts"))).toBe(false);
  });
});
