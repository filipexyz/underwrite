/**
 * Cloudflare agent test area: invite targeting + owner-only POST /test.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getAgentTest, POST as postAgentTest } from "@/app/api/account/agents/[id]/test/route";
import { POST as postPlan } from "@/app/api/v1/jobs/[requestId]/plans/route";
import { POST as postRequest } from "@/app/api/v1/requests/route";
import { LOCAL_DEV_USER_ID } from "@/lib/auth/session";
import { getDb, type Db } from "@/lib/db/client";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { MODEL_PROVIDER_REQUIRED_MESSAGE } from "@/lib/observability/inference";
import { isLoopbackHost, looksRemoteOrigin } from "@/lib/marketplace/agent-test";
import { resolveInvitees } from "@/lib/marketplace/push";
import { DEMO_REQUEST } from "@/lib/marketplace/requests";
import { registerSellerAgent } from "@/lib/marketplace/sellers";
import { loadRegistry } from "@/lib/marketplace/registry";
import { opsHintForPath } from "@/lib/ui/ops-hint";

let db: Db;

const draft = {
  role: "executor" as const,
  specialties: [TASK_CATEGORY],
  model_family: "family-test",
  model: "auto",
  baseline_confidence: 0.96,
  cost_ceiling_usd: 0.04,
  latency_class: "mid" as const,
  risk_tolerance: "mid" as const,
  webhook_url: "http://127.0.0.1:9/test-agent",
};

beforeAll(async () => {
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  ({ db } = await getDb());
});

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("invite targeting helpers", () => {
  it("detects localhost callbacks", () => {
    expect(isLoopbackHost("http://localhost:3000")).toBe(true);
    expect(isLoopbackHost("https://underwrite-cloudflare-seller.example.workers.dev")).toBe(false);
    expect(looksRemoteOrigin("https://underwrite.example")).toBe(true);
  });

  it("pins requested hireable agents and skips the rest", async () => {
    const keep = await registerSellerAgent(db, "user_invite_keep", { ...draft, name: "Keep" });
    const skip = await registerSellerAgent(db, "user_invite_skip", { ...draft, name: "Skip" });
    const registry = await loadRegistry(db, TASK_CATEGORY);
    const resolved = resolveInvitees(registry, TASK_CATEGORY, [keep.agent.agentId, "agt_missing", skip.agent.agentId]);
    expect(resolved.agents.map((a) => a.agentId)).toEqual([keep.agent.agentId, skip.agent.agentId]);
    expect(resolved.skipped).toEqual([{ agent_id: "agt_missing", reason: "not_hireable_or_unknown" }]);
  });
});

describe("POST /api/v1/requests invite_agent_ids", () => {
  it("invites only the requested agent", async () => {
    const target = await registerSellerAgent(db, "user_invite_target", { ...draft, name: "Target only" });
    const other = await registerSellerAgent(db, "user_invite_other", { ...draft, name: "Other" });

    const created = await postRequest(
      new Request("http://localhost/api/v1/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          execution_mode: "push",
          invite_agent_ids: [target.agent.agentId],
          task: DEMO_REQUEST.task,
          max_cost_usd: 0.05,
          max_latency_s: 30,
          min_confidence: 0.95,
        }),
      }),
    );
    expect(created.status).toBe(202);
    const job = (await created.json()) as { request_id: string; invited_agent_ids: string[]; requested_invite_agent_ids: string[] };
    expect(job.requested_invite_agent_ids).toEqual([target.agent.agentId]);
    expect(job.invited_agent_ids).toEqual([target.agent.agentId]);
    expect(job.invited_agent_ids).not.toContain(other.agent.agentId);

    const stolen = await postPlan(
      new Request(`http://localhost/api/v1/jobs/${job.request_id}/plans`, {
        method: "POST",
        headers: { authorization: `Bearer ${other.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ price_usd: 0.04, promised_confidence: 0.96, max_latency_s: 8 }),
      }),
      { params: Promise.resolve({ requestId: job.request_id }) },
    );
    expect(stolen.status).toBe(403);
  });

  it("rejects invite_agent_ids on the seed path", async () => {
    const denied = await postRequest(
      new Request("http://localhost/api/v1/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          execution_mode: "seed",
          invite_agent_ids: ["agt_x"],
          task: DEMO_REQUEST.task,
          max_cost_usd: 0.05,
          max_latency_s: 30,
          min_confidence: 0.95,
        }),
      }),
    );
    expect(denied.status).toBe(422);
  });
});

describe("account agent test API", () => {
  it("returns diagnosis for an owned agent and 404s for someone else's", async () => {
    const mine = await registerSellerAgent(db, LOCAL_DEV_USER_ID, { ...draft, name: "Local test agent" });
    const theirs = await registerSellerAgent(db, "user_not_me", { ...draft, name: "Not mine" });

    const ok = await getAgentTest(new Request("http://local/api/account/agents/x/test"), params(mine.agent.agentId));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      agent: { agent_id: string; owner_user_id: string };
      readiness: { checks: Array<{ id: string; ok: boolean; severity: string }>; model_provider_message: string | null };
      selection: { mode: string };
    };
    expect(body.agent.agent_id).toBe(mine.agent.agentId);
    expect(body.agent.owner_user_id).toBe(LOCAL_DEV_USER_ID);
    expect(body.selection.mode).toBe("invite_agent_ids");
    expect(body.readiness.checks.some((c) => c.id === "hosted_seller_base_url")).toBe(true);

    const denied = await getAgentTest(new Request("http://local/api/account/agents/x/test"), params(theirs.agent.agentId));
    expect(denied.status).toBe(404);
  });

  it("opens a real push job as the session user targeting the owned agent", async () => {
    const mine = await registerSellerAgent(db, LOCAL_DEV_USER_ID, { ...draft, name: "Runnable test agent" });
    const posted = await postAgentTest(
      new Request("http://local/api/account/agents/x/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      params(mine.agent.agentId),
    );
    expect(posted.status).toBe(202);
    const job = (await posted.json()) as {
      request_id: string;
      invited_agent_ids: string[];
      targeted: boolean;
      links: { console: string };
    };
    expect(job.targeted).toBe(true);
    expect(job.invited_agent_ids).toEqual([mine.agent.agentId]);
    expect(job.links.console).toBe(`/console/requests/${job.request_id}`);
  });

  it("409s when the agent is disabled", async () => {
    const mine = await registerSellerAgent(db, LOCAL_DEV_USER_ID, { ...draft, name: "Disabled test agent" });
    const { patchOwnedAgent } = await import("@/lib/marketplace/sellers");
    await patchOwnedAgent(db, mine.agent.agentId, LOCAL_DEV_USER_ID, { status: "disabled" });
    const posted = await postAgentTest(
      new Request("http://local/api/account/agents/x/test", { method: "POST" }),
      params(mine.agent.agentId),
    );
    expect(posted.status).toBe(409);
  });

  it("surfaces the same 503 when MODEL_PROVIDER_API_KEY is missing", async () => {
    const prev = process.env.MODEL_PROVIDER_API_KEY;
    const prevNl = process.env.NEURALAKE_API_KEY;
    const prevOai = process.env.OPENAI_API_KEY;
    delete process.env.MODEL_PROVIDER_API_KEY;
    delete process.env.NEURALAKE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const mine = await registerSellerAgent(db, LOCAL_DEV_USER_ID, { ...draft, name: "No provider agent" });
      const posted = await postAgentTest(
        new Request("http://local/api/account/agents/x/test", { method: "POST" }),
        params(mine.agent.agentId),
      );
      expect(posted.status).toBe(503);
      const body = (await posted.json()) as { error: string };
      expect(body.error).toBe(MODEL_PROVIDER_REQUIRED_MESSAGE);
    } finally {
      if (prev === undefined) delete process.env.MODEL_PROVIDER_API_KEY;
      else process.env.MODEL_PROVIDER_API_KEY = prev;
      if (prevNl === undefined) delete process.env.NEURALAKE_API_KEY;
      else process.env.NEURALAKE_API_KEY = prevNl;
      if (prevOai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOai;
    }
  });
});

describe("nav copy", () => {
  it("labels the test area in the ops hint", () => {
    expect(opsHintForPath("/agents/agt_1/test", "")).toBe("test · cloudflare agent");
  });
});
