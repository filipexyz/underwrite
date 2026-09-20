/**
 * auth.md registration, claim, token exchange, and /api/v1 JWT + legacy key cutover.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getAuthMd } from "@/app/auth.md/route";
import { GET as getPrm } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as getAs } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as postIdentity } from "@/app/agent/identity/route";
import { POST as postClaim } from "@/app/agent/identity/claim/route";
import { POST as postToken } from "@/app/oauth2/token/route";
import { POST as postRevoke } from "@/app/oauth2/revoke/route";
import { POST as postNotify } from "@/app/agent/event/notify/route";
import { GET as getMe } from "@/app/api/v1/agents/me/route";
import { GET as listRequests } from "@/app/api/v1/requests/route";
import { CLAIM_GRANT, JWT_BEARER_GRANT, completeUserClaim } from "@/lib/auth/auth-md";
import { isAdminUser, parseAdminAllowlist, rolesFromClaims } from "@/lib/auth/admin";
import { extractPresentedKey } from "@/lib/auth/api-keys";
import { BUYER_SCOPE, SELLER_AGENT_SCOPE, hasScope } from "@/lib/auth/scopes";
import { verifyAccessToken, verifyIdentityAssertion } from "@/lib/auth/tokens";
import { getDb } from "@/lib/db/client";
import { registerSellerAgent } from "@/lib/marketplace/sellers";
import { LOCAL_DEV_USER_ID } from "@/lib/auth/session";

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  const handle = await getDb();
  await handle.migrate();
});

describe("admin claims", () => {
  it("reads https://underwrite/roles and app_metadata.role", () => {
    expect(isAdminUser({ userId: "auth0|1", claims: { "https://underwrite/roles": ["admin"] } }, [])).toBe(true);
    expect(isAdminUser({ userId: "auth0|1", claims: { app_metadata: { role: "admin" } } }, [])).toBe(true);
    expect(isAdminUser({ userId: "auth0|1", claims: { "https://underwrite/role": "admin" } }, [])).toBe(true);
    expect(isAdminUser({ userId: "auth0|2", claims: {} }, ["auth0|2"])).toBe(true);
    expect(parseAdminAllowlist(" auth0|a, auth0|b ")).toEqual(["auth0|a", "auth0|b"]);
    expect(rolesFromClaims({ "https://underwrite/roles": "admin extra" })).toContain("admin");
    expect(isAdminUser({ userId: "auth0|1", claims: { role: "member" } }, [])).toBe(false);
  });
});

describe("discovery", () => {
  it("serves /auth.md and well-known metadata", async () => {
    const skill = await getAuthMd(new Request("http://localhost:3000/auth.md"));
    expect(skill.status).toBe(200);
    expect(skill.headers.get("content-type")).toMatch(/markdown/);
    const text = await skill.text();
    expect(text).toContain("POST /agent/identity");
    expect(text).toContain(BUYER_SCOPE);

    const prm = await (await getPrm(new Request("http://localhost:3000/.well-known/oauth-protected-resource"))).json();
    expect(prm.resource).toBe("http://localhost:3000/api/v1");
    expect(prm.scopes_supported).toContain(BUYER_SCOPE);
    expect(prm.authorization_servers[0]).toBe("http://localhost:3000/");

    const as = await (await getAs(new Request("http://localhost:3000/.well-known/oauth-authorization-server"))).json();
    expect(as.issuer).toBe("http://localhost:3000");
    expect(as.token_endpoint).toBe("http://localhost:3000/oauth2/token");
    expect(as.agent_auth.identity_endpoint).toBe("http://localhost:3000/agent/identity");
    expect(as.grant_types_supported).toContain(JWT_BEARER_GRANT);
  });
});

describe("anonymous → jwt-bearer → buyer JWT", () => {
  it("issues a pre-claim buyer token an agent can use on /api/v1/requests", async () => {
    const created = await postIdentity(
      jsonRequest("http://localhost:3000/agent/identity", { type: "anonymous", requested_scopes: [BUYER_SCOPE] }),
    );
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      registration_id: string;
      identity_assertion: string;
      claim_token: string;
      pre_claim_scopes: string[];
    };
    expect(body.pre_claim_scopes).toEqual([BUYER_SCOPE]);
    const assertion = await verifyIdentityAssertion(body.identity_assertion);
    expect(assertion?.registration_id).toBe(body.registration_id);
    expect(assertion?.claimed).toBe(false);

    const exchanged = await postToken(
      new Request("http://localhost:3000/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: JWT_BEARER_GRANT,
          assertion: body.identity_assertion,
          resource: "http://localhost:3000/api/v1",
        }),
      }),
    );
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as { access_token: string; scope: string };
    expect(tokens.scope).toContain(BUYER_SCOPE);
    const claims = await verifyAccessToken(tokens.access_token);
    expect(claims?.scopes).toContain(BUYER_SCOPE);
    expect(hasScope(claims!.scopes, BUYER_SCOPE)).toBe(true);

    const listed = await listRequests(
      new Request("http://localhost:3000/api/v1/requests", {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    );
    expect(listed.status).toBe(200);
    expect(listed.headers.get("WWW-Authenticate")).toBeNull();
  });
});

describe("service_auth claim ceremony", () => {
  it("stays pending until the human types the user_code, then issues a claimed token", async () => {
    const created = await postIdentity(
      jsonRequest("http://localhost:3000/agent/identity", {
        type: "service_auth",
        login_hint: "owner@example.com",
        requested_scopes: [BUYER_SCOPE],
      }),
    );
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      registration_id: string;
      claim_token: string;
      claim: { user_code: string; verification_uri: string };
    };
    expect(body.claim.user_code).toMatch(/^\d{6}$/);

    const pending = await postToken(
      new Request("http://localhost:3000/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: CLAIM_GRANT, claim_token: body.claim_token }),
      }),
    );
    expect(pending.status).toBe(400);
    expect((await pending.json()).error).toBe("authorization_pending");

    const tokenMatch = body.claim.verification_uri.match(/claim_attempt_token=([^&]+)/);
    expect(tokenMatch).toBeTruthy();
    const claimAttemptToken = decodeURIComponent(tokenMatch![1]);

    const claimed = await completeUserClaim((await getDb()).db, {
      userCode: body.claim.user_code,
      claimAttemptToken,
      userId: LOCAL_DEV_USER_ID,
      email: "owner@example.com",
    });
    // `droppedScopes` is empty here: this registration asked only for `buyer:requests`, which is
    // not ownership-bound, so nothing was withheld.
    expect(claimed).toEqual({ ok: true, registrationId: body.registration_id, droppedScopes: [] });

    const done = await postToken(
      new Request("http://localhost:3000/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: CLAIM_GRANT, claim_token: body.claim_token }),
      }),
    );
    expect(done.status).toBe(200);
    const tokens = (await done.json()) as { access_token: string; identity_assertion: string };
    const access = await verifyAccessToken(tokens.access_token);
    expect(access?.owner_user_id).toBe(LOCAL_DEV_USER_ID);
  });
});

describe("seller JWT + legacy key", () => {
  it("binds a claimed registration to an owned agent and still accepts hashed seller keys", async () => {
    const { db: shared } = await getDb();
    const seller = await registerSellerAgent(shared, LOCAL_DEV_USER_ID, {
      name: "JWT seller",
      role: "executor",
      specialties: ["html_to_pdf"],
      model_family: "family-jwt",
      model: "auto",
      baseline_confidence: 0.9,
      cost_ceiling_usd: 0.04,
      latency_class: "mid",
      risk_tolerance: "mid",
    });

    const created = await postIdentity(
      jsonRequest("http://localhost:3000/agent/identity", {
        type: "anonymous",
        requested_scopes: [BUYER_SCOPE, SELLER_AGENT_SCOPE],
        agent_id: seller.agent.agentId,
      }),
    );
    const body = (await created.json()) as { registration_id: string; claim_token: string; identity_assertion: string };
    const claim = await postClaim(
      jsonRequest("http://localhost:3000/agent/identity/claim", {
        claim_token: body.claim_token,
        email: "local@dev",
      }),
    );
    expect(claim.status).toBe(200);
    const claimBody = (await claim.json()) as { claim_attempt: { user_code: string; verification_uri: string } };
    const tokenMatch = claimBody.claim_attempt.verification_uri.match(/claim_attempt_token=([^&]+)/);
    const claimAttemptToken = decodeURIComponent(tokenMatch![1]);
    const finished = await completeUserClaim(shared, {
      userCode: claimBody.claim_attempt.user_code,
      claimAttemptToken,
      userId: LOCAL_DEV_USER_ID,
    });
    expect(finished.ok).toBe(true);

    const exchanged = await postToken(
      new Request("http://localhost:3000/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: JWT_BEARER_GRANT, assertion: body.identity_assertion }),
      }),
    );
    // pre-claim assertion is superseded after claim
    expect(exchanged.status).toBe(400);

    const polled = await postToken(
      new Request("http://localhost:3000/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: CLAIM_GRANT, claim_token: body.claim_token }),
      }),
    );
    expect(polled.status).toBe(200);
    const tokens = (await polled.json()) as { access_token: string; identity_assertion: string };
    const jwtMe = await getMe(
      new Request("http://localhost:3000/api/v1/agents/me", {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    );
    expect(jwtMe.status).toBe(200);
    expect(((await jwtMe.json()) as { agent: { agent_id: string } }).agent.agent_id).toBe(seller.agent.agentId);

    const keyMe = await getMe(
      new Request("http://localhost:3000/api/v1/agents/me", {
        headers: { authorization: `Bearer ${seller.secret}` },
      }),
    );
    expect(keyMe.status).toBe(200);

    await postRevoke(
      new Request("http://localhost:3000/oauth2/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.access_token, token_type_hint: "access_token" }),
      }),
    );
    const afterRevoke = await getMe(
      new Request("http://localhost:3000/api/v1/agents/me", {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    );
    expect(afterRevoke.status).toBe(401);

    const notified = await postNotify(jsonRequest("http://localhost:3000/agent/event/notify", { registration_id: body.registration_id }));
    expect(notified.status).toBe(200);
  });
});

describe("identity_assertion type", () => {
  it("returns issuer_not_enabled", async () => {
    const res = await postIdentity(
      jsonRequest("http://localhost:3000/agent/identity", {
        type: "identity_assertion",
        assertion: "not-a-jag",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("issuer_not_enabled");
  });
});

describe("extractPresentedKey still reads Bearer", () => {
  it("does not treat missing headers as a key", () => {
    expect(extractPresentedKey(new Headers())).toBeNull();
  });
});
