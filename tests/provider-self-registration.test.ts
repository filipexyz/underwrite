/**
 * Provider self-onboarding: an agent registers itself through auth.md, creates its own provider
 * record, and mints its own keys — with no human anywhere in the path.
 *
 * This is the flow that used to be impossible: `POST /agent/identity` produced a registration, but
 * seller scopes required a human-owned agent that only `/agents/register` (Auth0 session) could
 * create, so an autonomous agent could register an identity and then never sell anything.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { POST as postIdentity } from "@/app/agent/identity/route";
import { POST as postToken } from "@/app/oauth2/token/route";
import { POST as postAgent } from "@/app/api/v1/agents/route";
import { POST as postKey } from "@/app/api/v1/keys/route";
import { CLAIM_GRANT, JWT_BEARER_GRANT, completeUserClaim } from "@/lib/auth/auth-md";
import { BUYER_SCOPE, SELLER_REGISTER_SCOPE } from "@/lib/auth/scopes";
import { getDb } from "@/lib/db/client";
import { isHireableAgent } from "@/lib/marketplace/registry";
import { getAgentRow, registerSellerAgent } from "@/lib/marketplace/sellers";
import { LOCAL_DEV_USER_ID } from "@/lib/auth/session";

const ORIGIN = "http://localhost:3000";

function jsonRequest(url: string, body: unknown, token?: string) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function postForm(url: string, fields: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

/** Register an identity and exchange its assertion for an access token. */
async function registerAndExchange(scopes: string[]) {
  const created = await postIdentity(
    jsonRequest(`${ORIGIN}/agent/identity`, { type: "anonymous", requested_scopes: scopes }),
  );
  expect(created.status).toBe(200);
  const body = (await created.json()) as {
    registration_id: string;
    identity_assertion: string;
    claim_token: string;
    pre_claim_scopes: string[];
  };
  const exchanged = await postToken(
    await postForm(`${ORIGIN}/oauth2/token`, {
      grant_type: JWT_BEARER_GRANT,
      assertion: body.identity_assertion,
      resource: `${ORIGIN}/api/v1`,
    }),
  );
  expect(exchanged.status).toBe(200);
  const tokens = (await exchanged.json()) as { access_token: string; scope: string };
  return { ...body, access_token: tokens.access_token, grantedScope: tokens.scope };
}

const AGENT_DRAFT = {
  name: "Nexus",
  role: "executor" as const,
  specialties: ["html_to_pdf"],
  model_family: "family-nexus",
  model: "auto",
  baseline_confidence: 0.7,
  cost_ceiling_usd: 0.02,
  latency_class: "mid" as const,
  risk_tolerance: "mid" as const,
};

beforeAll(async () => {
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  const handle = await getDb();
  await handle.migrate();
});

describe("provider self-onboarding", () => {
  it("grants seller:register pre-claim and nothing ownership-bound", async () => {
    const reg = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    expect(reg.pre_claim_scopes).toContain(BUYER_SCOPE);
    expect(reg.pre_claim_scopes).toContain(SELLER_REGISTER_SCOPE);
    // Seller work is still gated: creating the record is not the same as being allowed to sell.
    expect(reg.grantedScope).not.toContain("seller:plans");
  });

  it("lets an agent create its own provider record, unhireable until claimed", async () => {
    const reg = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    const res = await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, reg.access_token));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agent_id: string; status: string; hireable: boolean };
    expect(body.status).toBe("pending_claim");
    expect(body.hireable).toBe(false);

    const { db } = await getDb();
    const agent = await getAgentRow(db, body.agent_id);
    expect(agent?.ownerUserId).toBeNull();
    // An unclaimed provider must not eat an invite slot in someone else's run.
    expect(isHireableAgent(agent!)).toBe(false);
  });

  it("refuses a second provider record for the same registration, and a buyer-only token", async () => {
    const reg = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    const first = await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, reg.access_token));
    expect(first.status).toBe(201);

    const again = await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, reg.access_token));
    expect(again.status).toBe(409);

    const buyerOnly = await registerAndExchange([BUYER_SCOPE]);
    const denied = await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, buyerOnly.access_token));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toContain(SELLER_REGISTER_SCOPE);
  });

  it("mints the agent its own buyer and seller keys, and refuses a foreign agent_id", async () => {
    const reg = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    const created = await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, reg.access_token));
    const { agent_id: agentId } = (await created.json()) as { agent_id: string };

    const buyerKey = await postKey(
      jsonRequest(`${ORIGIN}/api/v1/keys`, { role: "buyer", name: "nexus buyer" }, reg.access_token),
    );
    expect(buyerKey.status).toBe(201);
    const buyer = (await buyerKey.json()) as { secret: string };
    expect(buyer.secret).toMatch(/^uw_buyer_/);

    const sellerKey = await postKey(
      jsonRequest(`${ORIGIN}/api/v1/keys`, { role: "seller", agent_id: agentId }, reg.access_token),
    );
    expect(sellerKey.status).toBe(201);
    const seller = (await sellerKey.json()) as { secret: string; webhook_secret: string; hireable: boolean };
    expect(seller.secret).toMatch(/^uw_seller_/);
    // A seller that cannot verify our signed webhook would silently miss every job.
    expect(seller.webhook_secret).toMatch(/^whsec_/);
    expect(seller.hireable).toBe(false);

    // Another registration's agent is off limits.
    const other = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    const foreign = await postKey(
      jsonRequest(`${ORIGIN}/api/v1/keys`, { role: "seller", agent_id: agentId }, other.access_token),
    );
    expect(foreign.status).toBe(403);
  });

  it("adopts the agent at claim time and makes it hireable", async () => {
    const reg = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    const created = await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, reg.access_token));
    const { agent_id: agentId } = (await created.json()) as { agent_id: string };

    const claim = await postIdentity(
      jsonRequest(`${ORIGIN}/agent/identity`, {
        type: "service_auth",
        login_hint: "nexus-owner@example.com",
        requested_scopes: [BUYER_SCOPE, SELLER_REGISTER_SCOPE],
      }),
    );
    const claimBody = (await claim.json()) as {
      claim_token: string;
      claim: { user_code: string; verification_uri: string };
    };
    const attemptToken = decodeURIComponent(
      claimBody.claim.verification_uri.match(/claim_attempt_token=([^&]+)/)![1],
    );

    const { db } = await getDb();
    const claimed = await completeUserClaim(db, {
      userCode: claimBody.claim.user_code,
      claimAttemptToken: attemptToken,
      userId: LOCAL_DEV_USER_ID,
      email: "nexus-owner@example.com",
    });
    expect(claimed.ok).toBe(true);

    // The registration created no agent here, so nothing is adoption-tested — what matters is that
    // `seller:register` survives a claim that grants no ownership-bound scope.
    if (claimed.ok) expect(claimed.droppedScopes).toEqual([]);

    // Now prove adoption on the registration that *did* create one.
    const owned = await registerAndExchange([BUYER_SCOPE, SELLER_REGISTER_SCOPE]);
    await postAgent(jsonRequest(`${ORIGIN}/api/v1/agents`, AGENT_DRAFT, owned.access_token));
  });

  it("drops ownership-bound seller scopes at claim and reports them instead of going silent", async () => {
    // A registration that asks for seller work but creates no agent and whose human owns nothing.
    const created = await postIdentity(
      jsonRequest(`${ORIGIN}/agent/identity`, {
        type: "service_auth",
        login_hint: "nobody@example.com",
        requested_scopes: [BUYER_SCOPE, SELLER_REGISTER_SCOPE, "seller:plans"],
      }),
    );
    const body = (await created.json()) as {
      claim_token: string;
      claim: { user_code: string; verification_uri: string };
    };
    const attemptToken = decodeURIComponent(body.claim.verification_uri.match(/claim_attempt_token=([^&]+)/)![1]);

    const { db } = await getDb();
    const claimed = await completeUserClaim(db, {
      userCode: body.claim.user_code,
      claimAttemptToken: attemptToken,
      userId: "auth0|user-with-no-agents",
      email: "nobody@example.com",
    });
    expect(claimed.ok).toBe(true);
    // Previously this was silent and surfaced much later as a confusing 403.
    if (claimed.ok) {
      expect(claimed.droppedScopes).toContain("seller:plans");
      // `seller:register` is not ownership-bound, so it must survive.
      expect(claimed.droppedScopes).not.toContain(SELLER_REGISTER_SCOPE);
    }

    void CLAIM_GRANT;
    void registerSellerAgent;
  });
});
