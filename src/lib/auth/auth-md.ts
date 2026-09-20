/**
 * Open auth.md agent registration (WorkOS protocol shapes, implemented here
 * on Auth0 + Neon — no WorkOS dependency).
 *
 * Flow: discover PRM/AS → POST /agent/identity → claim if needed →
 * POST /oauth2/token → Bearer access_token on /api/v1.
 */
import { randomBytes, randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  agentClaimAttempts,
  agentRegistrations,
  revokedAccessTokens,
  type AgentRegistrationRow,
  type AgentRegistrationType,
} from "@/lib/db/schema";
import { hashApiKey } from "@/lib/auth/api-keys";
import { BUYER_SCOPE, SELLER_SCOPES, normalizeRequestedScopes, type ApiScope } from "@/lib/auth/scopes";
import { apiAudience, publicOrigin, resourceUrl, tokenIssuer } from "@/lib/auth/origin";
import {
  ACCESS_TOKEN_TTL_S,
  IDENTITY_ASSERTION_TTL_S,
  newJti,
  signUnderwriteJwt,
  verifyAccessToken,
  verifyIdentityAssertion,
} from "@/lib/auth/tokens";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { getOwnedAgent, listOwnedAgents } from "@/lib/marketplace/sellers";

export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const CLAIM_GRANT = "urn:workos:agent-auth:grant-type:claim";
export const CLAIM_WINDOW_S = 24 * 60 * 60;
export const USER_CODE_TTL_S = 600;
export const POLL_INTERVAL_S = 5;

export type AuthMdError = {
  ok: false;
  status: number;
  error: string;
  error_description?: string;
  extra?: Record<string, unknown>;
};

function fail(status: number, error: string, error_description?: string, extra?: Record<string, unknown>): AuthMdError {
  return { ok: false, status, error, error_description, extra };
}

export function mintClaimSecret(): string {
  return `clm_${randomBytes(24).toString("base64url")}`;
}

export function mintClaimAttemptSecret(): string {
  return `cla_${randomBytes(24).toString("base64url")}`;
}

export function mintUserCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function verificationUri(origin: string, claimAttemptToken: string): string {
  const claimPath = `/claim?claim_attempt_token=${encodeURIComponent(claimAttemptToken)}`;
  if (env.auth0.enabled) {
    return `${origin}/auth/login?returnTo=${encodeURIComponent(claimPath)}`;
  }
  return `${origin}${claimPath}`;
}

export function protectedResourceMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    resource: resourceUrl(request),
    resource_name: "Underwrite",
    authorization_servers: [`${origin}/`],
    scopes_supported: [BUYER_SCOPE, ...SELLER_SCOPES, "admin:*"],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(request: Request) {
  const origin = publicOrigin(request);
  const prm = protectedResourceMetadata(request);
  return {
    ...prm,
    issuer: origin,
    token_endpoint: `${origin}/oauth2/token`,
    revocation_endpoint: `${origin}/oauth2/revoke`,
    grant_types_supported: [JWT_BEARER_GRANT, CLAIM_GRANT],
    agent_auth: {
      skill: `${origin}/auth.md`,
      identity_endpoint: `${origin}/agent/identity`,
      claim_endpoint: `${origin}/agent/identity/claim`,
      events_endpoint: `${origin}/agent/event/notify`,
      identity_types_supported: ["anonymous", "identity_assertion", "service_auth"],
      identity_assertion: {
        assertion_types_supported: ["urn:ietf:params:oauth:token-type:id-jag"],
      },
      events_supported: ["https://schemas.workos.com/events/agent/auth/identity/assertion/revoked"],
    },
  };
}

function currentScopes(row: AgentRegistrationRow): string[] {
  return row.status === "claimed" ? row.postClaimScopes : row.preClaimScopes;
}

async function mintIdentityAssertion(
  row: AgentRegistrationRow,
  request: Request | undefined,
  extra?: { email?: string },
): Promise<{ token: string; jti: string; expires: Date }> {
  const jti = newJti();
  const expires = new Date(Date.now() + IDENTITY_ASSERTION_TTL_S * 1000);
  const claimed = row.status === "claimed";
  const token = await signUnderwriteJwt(
    {
      token_use: "identity_assertion",
      registration_id: row.registrationId,
      registration_type: row.registrationType,
      claimed,
      scopes: currentScopes(row),
      owner_user_id: row.ownerUserId ?? undefined,
      agent_id: row.agentId ?? undefined,
      email: extra?.email,
    },
    { expiresInS: IDENTITY_ASSERTION_TTL_S, subject: row.registrationId, jti, request },
  );
  return { token, jti, expires };
}

async function persistAssertion(db: Db, registrationId: string, jti: string, expires: Date): Promise<void> {
  await db
    .update(agentRegistrations)
    .set({ assertionJti: jti, assertionExpiresAt: expires, updatedAt: new Date() })
    .where(eq(agentRegistrations.registrationId, registrationId));
}

export async function mintAccessTokenFor(
  db: Db,
  row: AgentRegistrationRow,
  request?: Request,
): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: string; jti: string }> {
  const jti = newJti();
  const scopes = currentScopes(row);
  const token = await signUnderwriteJwt(
    {
      token_use: "access",
      registration_id: row.registrationId,
      owner_user_id: row.ownerUserId ?? undefined,
      agent_id: row.agentId ?? undefined,
      scope: scopes.join(" "),
      scopes,
    },
    {
      expiresInS: ACCESS_TOKEN_TTL_S,
      subject: row.ownerUserId ?? row.registrationId,
      jti,
      request,
    },
  );
  return { access_token: token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, scope: scopes.join(" "), jti };
}

async function createClaimAttempt(db: Db, registrationId: string, origin: string) {
  const userCode = mintUserCode();
  const attemptToken = mintClaimAttemptSecret();
  const expiresAt = new Date(Date.now() + USER_CODE_TTL_S * 1000);
  await db.insert(agentClaimAttempts).values({
    claimAttemptId: newId("cla"),
    registrationId,
    userCode,
    claimAttemptTokenHash: hashApiKey(attemptToken),
    expiresAt,
    intervalSeconds: POLL_INTERVAL_S,
  });
  return {
    user_code: userCode,
    expires_in: USER_CODE_TTL_S,
    verification_uri: verificationUri(origin, attemptToken),
    interval: POLL_INTERVAL_S,
    claim_attempt_token: attemptToken,
  };
}

export async function registerIdentity(
  db: Db,
  body: Record<string, unknown>,
  request: Request,
): Promise<
  | { ok: true; status: number; body: Record<string, unknown> }
  | AuthMdError
> {
  const type = body.type;
  if (type === "identity_assertion") {
    return fail(
      400,
      "issuer_not_enabled",
      "ID-JAG / identity_assertion is not on this tenant's trust list. Use service_auth or anonymous.",
    );
  }
  if (type !== "anonymous" && type !== "service_auth") {
    return fail(400, "invalid_request", "type must be anonymous, service_auth, or identity_assertion");
  }

  const requested = normalizeRequestedScopes(body.requested_scopes);
  const agentId = typeof body.agent_id === "string" && body.agent_id.trim() ? body.agent_id.trim() : null;
  const loginHint = typeof body.login_hint === "string" && body.login_hint.trim() ? body.login_hint.trim().toLowerCase() : null;
  const preClaimScopes: ApiScope[] = type === "anonymous" ? requested.filter((scope) => scope === BUYER_SCOPE) : [];
  const postClaimScopes = requested;
  const claimToken = mintClaimSecret();
  const claimExpires = new Date(Date.now() + CLAIM_WINDOW_S * 1000);
  const origin = publicOrigin(request);

  const [row] = await db
    .insert(agentRegistrations)
    .values({
      registrationId: newId("reg"),
      registrationType: type as AgentRegistrationType,
      status: "pending",
      ownerUserId: null,
      loginHint,
      agentId,
      requestedScopes: requested,
      preClaimScopes,
      postClaimScopes,
      claimTokenHash: hashApiKey(claimToken),
      claimExpiresAt: claimExpires,
    })
    .returning();

  if (type === "service_auth") {
    const claim = await createClaimAttempt(db, row.registrationId, origin);
    return {
      ok: true,
      status: 200,
      body: {
        registration_id: row.registrationId,
        registration_type: "service_auth",
        claim_url: `${origin}/agent/identity/claim`,
        claim_token: claimToken,
        claim_token_expires: claimExpires.toISOString(),
        post_claim_scopes: postClaimScopes,
        claim: {
          user_code: claim.user_code,
          expires_in: claim.expires_in,
          verification_uri: claim.verification_uri,
          interval: claim.interval,
        },
      },
    };
  }

  const assertion = await mintIdentityAssertion(row, request);
  await persistAssertion(db, row.registrationId, assertion.jti, assertion.expires);
  return {
    ok: true,
    status: 200,
    body: {
      registration_id: row.registrationId,
      registration_type: "anonymous",
      identity_assertion: assertion.token,
      assertion_expires: assertion.expires.toISOString(),
      pre_claim_scopes: preClaimScopes,
      claim_url: `${origin}/agent/identity/claim`,
      claim_token: claimToken,
      claim_token_expires: claimExpires.toISOString(),
      post_claim_scopes: postClaimScopes,
    },
  };
}

async function registrationByClaimToken(db: Db, claimToken: string): Promise<AgentRegistrationRow | null> {
  const [row] = await db
    .select()
    .from(agentRegistrations)
    .where(eq(agentRegistrations.claimTokenHash, hashApiKey(claimToken)))
    .limit(1);
  return row ?? null;
}

export async function startClaimCeremony(
  db: Db,
  body: Record<string, unknown>,
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | AuthMdError> {
  const claimToken = typeof body.claim_token === "string" ? body.claim_token : "";
  if (!claimToken) return fail(400, "invalid_claim_token", "claim_token is required");
  const row = await registrationByClaimToken(db, claimToken);
  if (!row) return fail(400, "invalid_claim_token", "claim_token is wrong or expired");
  if (row.status === "revoked") return fail(410, "claim_expired", "registration was revoked");
  if (row.status === "claimed") return fail(400, "claimed_or_in_flight", "registration is already claimed");
  if (row.claimExpiresAt && row.claimExpiresAt.getTime() < Date.now()) {
    return fail(410, "claim_expired", "the outer claim window has closed; restart at POST /agent/identity");
  }
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
  if (email) {
    await db
      .update(agentRegistrations)
      .set({ loginHint: email, updatedAt: new Date() })
      .where(eq(agentRegistrations.registrationId, row.registrationId));
  }
  const origin = publicOrigin(request);
  const claim = await createClaimAttempt(db, row.registrationId, origin);
  return {
    ok: true,
    body: {
      registration_id: row.registrationId,
      claim_attempt_id: undefined,
      status: "initiated",
      expires_at: new Date(Date.now() + USER_CODE_TTL_S * 1000).toISOString(),
      claim_attempt: {
        user_code: claim.user_code,
        expires_in: claim.expires_in,
        verification_uri: claim.verification_uri,
        interval: claim.interval,
      },
    },
  };
}

export async function loadClaimAttemptByToken(db: Db, claimAttemptToken: string) {
  const [attempt] = await db
    .select()
    .from(agentClaimAttempts)
    .where(eq(agentClaimAttempts.claimAttemptTokenHash, hashApiKey(claimAttemptToken)))
    .limit(1);
  if (!attempt) return null;
  const [registration] = await db
    .select()
    .from(agentRegistrations)
    .where(eq(agentRegistrations.registrationId, attempt.registrationId))
    .limit(1);
  if (!registration) return null;
  return { attempt, registration };
}

export async function completeUserClaim(
  db: Db,
  args: { userCode: string; claimAttemptToken: string; userId: string; email?: string },
): Promise<{ ok: true; registrationId: string } | { ok: false; error: string }> {
  const loaded = await loadClaimAttemptByToken(db, args.claimAttemptToken);
  if (!loaded) return { ok: false, error: "unknown claim attempt" };
  const { attempt, registration } = loaded;
  if (registration.status === "revoked") return { ok: false, error: "registration was revoked" };
  if (registration.status === "claimed") return { ok: false, error: "already claimed" };
  if (attempt.expiresAt.getTime() < Date.now()) return { ok: false, error: "this code expired — ask the agent for a new one" };
  const presented = args.userCode.replace(/\s+/g, "");
  if (presented !== attempt.userCode) return { ok: false, error: "that code does not match" };

  if (registration.loginHint && env.auth0.enabled) {
    const email = args.email?.trim().toLowerCase();
    if (!email || email !== registration.loginHint) {
      return { ok: false, error: `sign in as ${registration.loginHint} to claim this agent` };
    }
  }

  let agentId = registration.agentId;
  const wantsSeller = registration.postClaimScopes.some((scope) => scope.startsWith("seller:"));
  if (wantsSeller) {
    if (agentId) {
      const owned = await getOwnedAgent(db, agentId, args.userId);
      if (!owned) return { ok: false, error: "you do not own the agent this registration asked to bind" };
    } else {
      const owned = await listOwnedAgents(db, args.userId);
      agentId = owned[0]?.agentId ?? null;
    }
  }

  const postClaimScopes = wantsSeller && !agentId
    ? registration.postClaimScopes.filter((scope) => !scope.startsWith("seller:"))
    : registration.postClaimScopes;

  await db
    .update(agentRegistrations)
    .set({
      status: "claimed",
      ownerUserId: args.userId,
      agentId,
      postClaimScopes,
      assertionJti: null,
      assertionExpiresAt: null,
      credentialEpoch: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentRegistrations.registrationId, registration.registrationId));

  return { ok: true, registrationId: registration.registrationId };
}

export async function exchangeToken(
  db: Db,
  params: URLSearchParams,
  request: Request,
): Promise<{ ok: true; status: number; body: Record<string, unknown> } | AuthMdError> {
  const grant = params.get("grant_type") ?? "";
  if (grant === CLAIM_GRANT) return pollClaimGrant(db, params, request);
  if (grant === JWT_BEARER_GRANT) return jwtBearerGrant(db, params, request);
  return fail(400, "unsupported_grant_type", "grant_type must be jwt-bearer or the auth.md claim grant");
}

async function pollClaimGrant(
  db: Db,
  params: URLSearchParams,
  request: Request,
): Promise<{ ok: true; status: number; body: Record<string, unknown> } | AuthMdError> {
  const claimToken = params.get("claim_token") ?? "";
  if (!claimToken) return fail(400, "invalid_request", "claim_token is required");
  const row = await registrationByClaimToken(db, claimToken);
  if (!row) return fail(400, "invalid_grant", "claim_token is wrong or expired");
  if (row.status === "revoked") return fail(400, "invalid_grant", "registration was revoked");
  if (row.claimExpiresAt && row.claimExpiresAt.getTime() < Date.now() && row.status !== "claimed") {
    return fail(400, "expired_token", "the outer claim window has closed");
  }

  const [attempt] = await db
    .select()
    .from(agentClaimAttempts)
    .where(eq(agentClaimAttempts.registrationId, row.registrationId))
    .orderBy(desc(agentClaimAttempts.createdAt))
    .limit(1);

  if (row.status !== "claimed") {
    if (attempt) {
      const minInterval = (attempt.intervalSeconds || POLL_INTERVAL_S) * 1000;
      if (attempt.lastPollAt && Date.now() - attempt.lastPollAt.getTime() < minInterval) {
        return fail(400, "slow_down", "polling too fast; add 5s to your interval");
      }
      await db
        .update(agentClaimAttempts)
        .set({ lastPollAt: new Date() })
        .where(eq(agentClaimAttempts.claimAttemptId, attempt.claimAttemptId));
    }
    if (attempt && attempt.expiresAt.getTime() < Date.now()) {
      return fail(400, "expired_token", "user_code window closed; POST /agent/identity/claim for a fresh code");
    }
    return fail(400, "authorization_pending", "user has not completed the claim ceremony");
  }

  const fresh = (await getRegistration(db, row.registrationId)) ?? row;
  const tokens = await mintAccessTokenFor(db, fresh, request);
  const assertion = await mintIdentityAssertion(fresh, request);
  await persistAssertion(db, fresh.registrationId, assertion.jti, assertion.expires);
  return {
    ok: true,
    status: 200,
    body: {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      identity_assertion: assertion.token,
      assertion_expires: assertion.expires.toISOString(),
    },
  };
}

async function jwtBearerGrant(
  db: Db,
  params: URLSearchParams,
  request: Request,
): Promise<{ ok: true; status: number; body: Record<string, unknown> } | AuthMdError> {
  const assertion = params.get("assertion") ?? "";
  if (!assertion) return fail(400, "invalid_request", "assertion is required");
  const claims = await verifyIdentityAssertion(assertion);
  if (!claims) return fail(400, "invalid_grant", "identity_assertion failed verification");
  const row = await getRegistration(db, claims.registration_id);
  if (!row || row.status === "revoked") return fail(400, "invalid_grant", "registration is missing or revoked");
  if (!row.assertionJti || row.assertionJti !== claims.jti) {
    return fail(400, "invalid_grant", "identity_assertion was superseded or is not current");
  }
  if (row.registrationType === "service_auth" && row.status !== "claimed") {
    return fail(400, "invalid_grant", "service_auth registrations must finish the claim ceremony first");
  }
  const resource = params.get("resource");
  if (resource && resource !== resourceUrl(request) && resource !== apiAudience()) {
    return fail(400, "invalid_grant", "resource does not match this API");
  }
  const tokens = await mintAccessTokenFor(db, row, request);
  return {
    ok: true,
    status: 200,
    body: {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    },
  };
}

export async function revokeAccessToken(db: Db, token: string): Promise<void> {
  const claims = await verifyAccessToken(token);
  if (!claims?.jti) return;
  await db
    .insert(revokedAccessTokens)
    .values({ jti: claims.jti, registrationId: claims.registration_id ?? null })
    .onConflictDoNothing();
}

export async function revokeRegistration(db: Db, registrationId: string): Promise<AgentRegistrationRow | null> {
  const [row] = await db
    .update(agentRegistrations)
    .set({ status: "revoked", credentialEpoch: new Date(), updatedAt: new Date() })
    .where(eq(agentRegistrations.registrationId, registrationId))
    .returning();
  return row ?? null;
}

export async function getRegistration(db: Db, registrationId: string): Promise<AgentRegistrationRow | null> {
  const [row] = await db
    .select()
    .from(agentRegistrations)
    .where(eq(agentRegistrations.registrationId, registrationId))
    .limit(1);
  return row ?? null;
}

export async function listOwnedRegistrations(db: Db, ownerUserId: string): Promise<AgentRegistrationRow[]> {
  return db
    .select()
    .from(agentRegistrations)
    .where(eq(agentRegistrations.ownerUserId, ownerUserId))
    .orderBy(desc(agentRegistrations.createdAt));
}

export async function listRegistrations(db: Db, limit = 50): Promise<AgentRegistrationRow[]> {
  return db.select().from(agentRegistrations).orderBy(desc(agentRegistrations.createdAt)).limit(limit);
}

export async function isAccessTokenLive(db: Db, claims: { jti: string; iat: number; registration_id?: string }): Promise<boolean> {
  if (claims.jti) {
    const [revoked] = await db.select().from(revokedAccessTokens).where(eq(revokedAccessTokens.jti, claims.jti)).limit(1);
    if (revoked) return false;
  }
  if (!claims.registration_id) return true;
  const row = await getRegistration(db, claims.registration_id);
  if (!row || row.status === "revoked") return false;
  if (row.credentialEpoch && claims.iat * 1000 < row.credentialEpoch.getTime() - 2000) return false;
  return true;
}

export function toPublicRegistration(row: AgentRegistrationRow) {
  return {
    registration_id: row.registrationId,
    registration_type: row.registrationType,
    status: row.status,
    owner_user_id: row.ownerUserId,
    agent_id: row.agentId,
    scopes: currentScopes(row),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export { tokenIssuer };
