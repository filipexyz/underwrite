/**
 * Unified /api/v1 authorization: Auth0 session, Auth0 / auth.md JWTs,
 * hashed buyer/seller keys, and the legacy UNDERWRITE_API_KEY.
 */
import type { NextResponse } from "next/server";
import {
  resolveBuyerAuth as resolveBuyerKeyAuth,
  resolveSellerAuth as resolveSellerKeyAuth,
  type BuyerAuth as BuyerKeyAuth,
} from "@/lib/auth/api-keys";
import { isAccessTokenLive } from "@/lib/auth/auth-md";
import { BUYER_SCOPE, hasScope, inferSellerScope, type ApiScope } from "@/lib/auth/scopes";
import { resolveSessionIdentity } from "@/lib/auth/session";
import { looksLikeJwt, verifyAccessToken, type UnderwriteAccessClaims } from "@/lib/auth/tokens";
import { getDb } from "@/lib/db/client";
import type { ApiKeyRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { publicOrigin } from "@/lib/auth/origin";

export type AuthFailure = { ok: false; status: number; error: string };

export type BuyerAuth =
  | BuyerKeyAuth
  | { kind: "session"; userId: string; admin: boolean }
  | { kind: "jwt"; claims: UnderwriteAccessClaims };

export type SellerAuth =
  | { kind: "key"; key: ApiKeyRow; agentId: string }
  | { kind: "jwt"; claims: UnderwriteAccessClaims; agentId: string };

export type RegistrationAuth = {
  registrationId: string;
  ownerUserId?: string;
  agentId?: string;
  scopes: string[];
};

export function buyerWalletOwnerId(auth: BuyerAuth): string | undefined {
  if (auth.kind === "key") return auth.key.ownerUserId ?? undefined;
  if (auth.kind === "session") return auth.userId;
  if (auth.kind === "jwt") return auth.claims.owner_user_id;
  return undefined;
}

export function wwwAuthenticate(request: Request): string {
  return `Bearer resource_metadata="${publicOrigin(request)}/.well-known/oauth-protected-resource"`;
}

export async function resolveBuyerRequestAuth(opts: {
  request: Request;
  presented: string | null;
  legacyKey: string | undefined;
}): Promise<{ ok: true; auth: BuyerAuth } | AuthFailure> {
  const { presented, legacyKey } = opts;
  const { db } = await getDb();

  if (presented && looksLikeJwt(presented)) {
    const claims = await verifyAccessToken(presented);
    if (!claims) return { ok: false, status: 401, error: "missing or invalid access token" };
    if (!(await isAccessTokenLive(db, claims))) {
      return { ok: false, status: 401, error: "access token was revoked" };
    }
    if (!hasScope(claims.scopes, BUYER_SCOPE)) {
      return { ok: false, status: 403, error: "token is missing scope buyer:requests" };
    }
    return { ok: true, auth: { kind: "jwt", claims } };
  }

  const keyed = await resolveBuyerKeyAuth({ presented, legacyKey, db });
  if (keyed.ok && keyed.auth.kind !== "public") return keyed;
  if (!keyed.ok) return keyed;

  if (env.auth0.enabled) {
    const session = await resolveSessionIdentity();
    if (session) return { ok: true, auth: { kind: "session", userId: session.userId, admin: session.admin } };
  }

  return keyed;
}

export async function resolveSellerRequestAuth(opts: {
  request: Request;
  presented: string | null;
  scope?: ApiScope;
}): Promise<{ ok: true; auth: SellerAuth } | AuthFailure> {
  const { request, presented } = opts;
  const { db } = await getDb();
  const required = opts.scope ?? inferSellerScope(new URL(request.url).pathname);

  if (presented && looksLikeJwt(presented)) {
    const claims = await verifyAccessToken(presented);
    if (!claims) return { ok: false, status: 401, error: "missing or invalid access token" };
    if (!(await isAccessTokenLive(db, claims))) {
      return { ok: false, status: 401, error: "access token was revoked" };
    }
    if (!hasScope(claims.scopes, required)) {
      return { ok: false, status: 403, error: `token is missing scope ${required}` };
    }
    if (!claims.agent_id) return { ok: false, status: 401, error: "token is not bound to a seller agent" };
    return { ok: true, auth: { kind: "jwt", claims, agentId: claims.agent_id } };
  }

  const keyed = await resolveSellerKeyAuth({ presented, db });
  if (!keyed.ok) return keyed;
  return { ok: true, auth: { kind: "key", key: keyed.key, agentId: keyed.agentId } };
}

/**
 * Resolve a live auth.md registration token that carries `scope`, **without** requiring a bound
 * seller agent.
 *
 * `resolveSellerRequestAuth` cannot serve provider self-onboarding: it insists on `claims.agent_id`,
 * which is precisely what the caller is trying to create. This resolver is intentionally narrower —
 * token only, no hashed keys, no session — so it can only ever be used by an agent that completed
 * the auth.md flow.
 */
export async function resolveRegistrationAuth(opts: {
  presented: string | null;
  scope: ApiScope;
}): Promise<{ ok: true; auth: RegistrationAuth } | AuthFailure> {
  const { presented, scope } = opts;
  if (!presented || !looksLikeJwt(presented)) {
    return {
      ok: false,
      status: 401,
      error: "missing bearer token: this endpoint requires a registration token from /agent/identity",
    };
  }
  const claims = await verifyAccessToken(presented);
  if (!claims) return { ok: false, status: 401, error: "missing or invalid access token" };
  const { db } = await getDb();
  if (!(await isAccessTokenLive(db, claims))) {
    return { ok: false, status: 401, error: "access token was revoked" };
  }
  if (!hasScope(claims.scopes, scope)) {
    return { ok: false, status: 403, error: `token is missing scope ${scope}` };
  }
  if (!claims.registration_id) {
    return { ok: false, status: 401, error: "token is not bound to a registration" };
  }
  return {
    ok: true,
    auth: {
      registrationId: claims.registration_id,
      ownerUserId: claims.owner_user_id,
      agentId: claims.agent_id,
      scopes: claims.scopes,
    },
  };
}

export function attachChallenge(response: NextResponse, request: Request): NextResponse {  if (!response.headers.has("WWW-Authenticate")) {
    response.headers.set("WWW-Authenticate", wwwAuthenticate(request));
  }
  return response;
}
