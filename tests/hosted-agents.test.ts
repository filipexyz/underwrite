/**
 * Multi-tenant hosted sellers: per-user create, per-agent HMAC / seller key,
 * and isolation so user B cannot operate user A’s agent.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getInternalHosted } from "@/app/api/internal/hosted-agents/[id]/route";
import { POST as postAccountAgent } from "@/app/api/account/agents/route";
import { GET as getOwnedAgentApi } from "@/app/api/account/agents/[id]/route";
import { POST as postOwnedKey } from "@/app/api/account/agents/[id]/keys/route";
import { POST as postPlan } from "@/app/api/v1/jobs/[requestId]/plans/route";
import { POST as postRequest } from "@/app/api/v1/requests/route";
import { LOCAL_DEV_USER_ID } from "@/lib/auth/session";
import { resolveSellerAuth } from "@/lib/auth/api-keys";
import { decryptSecret, encryptSecret, generateWebhookSecret } from "@/lib/crypto/secrets";
import { getDb, type Db } from "@/lib/db/client";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { resolveWebhookSecret } from "@/lib/marketplace/agent-runtime";
import { DEMO_REQUEST } from "@/lib/marketplace/requests";
import { registerSellerAgent } from "@/lib/marketplace/sellers";
import { signWebhookBody, verifyWebhookSignature } from "@/lib/marketplace/webhooks";

let db: Db;

const draft = {
  name: "Hosted renderer",
  role: "executor" as const,
  specialties: [TASK_CATEGORY],
  model_family: "family-hosted",
  model: "auto",
  baseline_confidence: 0.96,
  cost_ceiling_usd: 0.04,
  latency_class: "mid" as const,
  risk_tolerance: "mid" as const,
};

beforeAll(async () => {
  process.env.UNDERWRITE_HOSTED_RUNTIME_SECRET = "runtime-test-secret";
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  ({ db } = await getDb());
});

async function withHostedBase<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.HOSTED_SELLER_BASE_URL;
  process.env.HOSTED_SELLER_BASE_URL = "https://underwrite-cloudflare-seller.test";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.HOSTED_SELLER_BASE_URL;
    else process.env.HOSTED_SELLER_BASE_URL = prev;
  }
}

describe("secret encryption", () => {
  it("round-trips and does not store plaintext", () => {
    const secret = "uw_seller_not-in-db";
    const blob = encryptSecret(secret);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain(secret);
    expect(decryptSecret(blob)).toBe(secret);
    expect(generateWebhookSecret().startsWith("whsec_")).toBe(true);
  });
});

describe("create hosted agent", () => {
  it("mints a bound seller key, per-agent HMAC, and hosted webhook URL", async () => {
    const created = await withHostedBase(() =>
      registerSellerAgent(db, "user_alice", {
        ...draft,
        name: "Alice hosted",
        hosted: true,
        byok_api_key: "nl-alice-key",
      }),
    );
    expect(created.secret.startsWith("uw_seller_")).toBe(true);
    expect(created.webhook_secret.startsWith("whsec_")).toBe(true);
    expect(created.agent.ownerUserId).toBe("user_alice");
    expect(created.agent.webhookUrl).toBe(
      `https://underwrite-cloudflare-seller.test/webhook/${created.agent.agentId}`,
    );
    expect(created.runtime.kind).toBe("hosted");
    expect(created.runtime.byok_configured).toBe(true);
    expect(created.runtime.webhook_secret_configured).toBe(true);

    const hmac = await resolveWebhookSecret(db, created.agent.agentId);
    expect(hmac.keyId).toBe(`agent:${created.agent.agentId}`);
    expect(hmac.secret).toBe(created.webhook_secret);
    expect(hmac.secret).not.toBe("underwrite-webhook-stub");
  });
});

describe("isolation: user A vs user B", () => {
  let aliceSecret: string;
  let bobSecret: string;
  let aliceId: string;
  let bobId: string;
  let aliceWebhook: string;
  let bobWebhook: string;

  beforeAll(async () => {
    const alice = await registerSellerAgent(db, "user_alice_iso", { ...draft, name: "Alice iso", hosted: true });
    const bob = await registerSellerAgent(db, "user_bob_iso", { ...draft, name: "Bob iso", hosted: true });
    aliceSecret = alice.secret;
    bobSecret = bob.secret;
    aliceId = alice.agent.agentId;
    bobId = bob.agent.agentId;
    aliceWebhook = alice.webhook_secret;
    bobWebhook = bob.webhook_secret;
  });

  it("seller keys resolve only to their bound agent", async () => {
    const a = await resolveSellerAuth({ presented: aliceSecret, db });
    const b = await resolveSellerAuth({ presented: bobSecret, db });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) expect(a.agentId).toBe(aliceId);
    if (b.ok) expect(b.agentId).toBe(bobId);
    expect(aliceSecret).not.toBe(bobSecret);
    expect(aliceWebhook).not.toBe(bobWebhook);
  });

  it("Bob’s HMAC secret cannot verify Alice’s webhook", () => {
    const body = JSON.stringify({ type: "plan_request", job_id: "req_iso" });
    const timestamp = "1710000000000";
    const signature = signWebhookBody(body, timestamp, aliceWebhook);
    expect(verifyWebhookSignature({ body, timestamp, signature, secret: aliceWebhook })).toBe(true);
    expect(verifyWebhookSignature({ body, timestamp, signature, secret: bobWebhook })).toBe(false);
  });

  it("account APIs 404 when Bob’s session asks for Alice’s agent", async () => {
    const denied = await getOwnedAgentApi(new Request("http://local/api/account/agents/x"), {
      params: Promise.resolve({ id: aliceId }),
    });
    expect(denied.status).toBe(404);

    const mint = await postOwnedKey(
      new Request("http://local/api/account/agents/x/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "stolen" }),
      }),
      { params: Promise.resolve({ id: aliceId }) },
    );
    expect(mint.status).toBe(404);
  });

  it("Bob’s seller key cannot act as Alice on a push job", async () => {
    const prevK = process.env.MARKETPLACE_TOP_K;
    process.env.MARKETPLACE_TOP_K = "8";
    const created = await postRequest(
      new Request("http://localhost/api/v1/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          execution_mode: "push",
          task: DEMO_REQUEST.task,
          max_cost_usd: 0.05,
          max_latency_s: 30,
          min_confidence: 0.95,
        }),
      }),
    );
    if (prevK === undefined) delete process.env.MARKETPLACE_TOP_K;
    else process.env.MARKETPLACE_TOP_K = prevK;
    expect(created.status).toBe(202);
    const job = (await created.json()) as { request_id: string; invited_agent_ids: string[] };

    const asBob = await postPlan(
      new Request(`http://localhost/api/v1/jobs/${job.request_id}/plans`, {
        method: "POST",
        headers: { authorization: `Bearer ${bobSecret}`, "content-type": "application/json" },
        body: JSON.stringify({
          price_usd: 0.04,
          promised_confidence: 0.96,
          max_latency_s: 8,
        }),
      }),
      { params: Promise.resolve({ requestId: job.request_id }) },
    );
    const bobBody = (await asBob.json()) as { error?: string; plan?: { agent_id?: string } };
    if (job.invited_agent_ids.includes(bobId)) {
      expect(asBob.status).toBe(201);
      expect(bobBody.plan?.agent_id).toBe(bobId);
      expect(bobBody.plan?.agent_id).not.toBe(aliceId);
    } else {
      expect(asBob.status).toBe(403);
    }

    const stolen = await resolveSellerAuth({ presented: aliceSecret, db });
    expect(stolen.ok).toBe(true);
    if (stolen.ok) expect(stolen.agentId).not.toBe(bobId);
  });

  it("internal hosted pull requires the runtime secret and returns only that agent", async () => {
    const denied = await getInternalHosted(new Request("http://local/api/internal/hosted-agents/x"), {
      params: Promise.resolve({ id: aliceId }),
    });
    expect(denied.status).toBe(401);

    const ok = await getInternalHosted(
      new Request("http://local/api/internal/hosted-agents/x", {
        headers: { authorization: "Bearer runtime-test-secret" },
      }),
      { params: Promise.resolve({ id: aliceId }) },
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      agent: { agent_id: string; seller_api_key: string; webhook_secret: string; owner_user_id: string };
    };
    expect(body.agent.agent_id).toBe(aliceId);
    expect(body.agent.seller_api_key).toBe(aliceSecret);
    expect(body.agent.webhook_secret).toBe(aliceWebhook);
    expect(body.agent.owner_user_id).toBe("user_alice_iso");
    expect(body.agent.seller_api_key).not.toBe(bobSecret);
  });
});

describe("account create API (local-dev session)", () => {
  it("returns the one-time seller key and webhook secret", async () => {
    const created = await withHostedBase(() =>
      postAccountAgent(
        new Request("http://local/api/account/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Local hosted",
            role: "executor",
            specialties: [TASK_CATEGORY],
            model_family: "family-local",
            hosted: true,
          }),
        }),
      ),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      secret: string;
      webhook_secret: string;
      agent: { owner_user_id: string; webhook_url: string };
      runtime: { kind: string };
    };
    expect(body.secret.startsWith("uw_seller_")).toBe(true);
    expect(body.webhook_secret.startsWith("whsec_")).toBe(true);
    expect(body.agent.owner_user_id).toBe(LOCAL_DEV_USER_ID);
    expect(body.runtime.kind).toBe("hosted");
    expect(body.agent.webhook_url).toContain(`/webhook/`);
  });
});
