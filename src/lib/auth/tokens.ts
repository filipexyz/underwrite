/**
 * JWT mint + verify for marketplace /api/v1.
 *
 * Two issuers are accepted:
 * - Underwrite HS256 tokens from the auth.md token endpoint (`token_use: access`)
 * - Auth0 RS256 access tokens (JWKS) when AUTH0_DOMAIN is set, `aud` = AUTH0_AUDIENCE
 */
import * as jose from "jose";
import { createHash } from "node:crypto";
import { isAdminUser, rolesFromClaims, asRecord } from "@/lib/auth/admin";
import { apiAudience, tokenIssuer } from "@/lib/auth/origin";
import { ADMIN_SCOPE, parseScopeList } from "@/lib/auth/scopes";
import { env } from "@/lib/env";

export const ACCESS_TOKEN_TTL_S = 3600;
export const IDENTITY_ASSERTION_TTL_S = 24 * 60 * 60;

export type TokenUse = "access" | "identity_assertion";

export type UnderwriteAccessClaims = {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  exp: number;
  iat: number;
  token_use: "access";
  scope: string;
  scopes: string[];
  registration_id?: string;
  owner_user_id?: string;
  agent_id?: string;
  source: "underwrite" | "auth0";
};

export type IdentityAssertionClaims = {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  exp: number;
  iat: number;
  token_use: "identity_assertion";
  registration_id: string;
  registration_type: string;
  claimed: boolean;
  scopes: string[];
  owner_user_id?: string;
  agent_id?: string;
  email?: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.tokenSecret);
}

export function looksLikeJwt(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function newJti(): string {
  return createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
}

export async function signUnderwriteJwt(
  claims: Record<string, unknown>,
  opts: { expiresInS: number; subject: string; jti: string; request?: Request },
): Promise<string> {
  const iss = tokenIssuer(opts.request);
  const aud = apiAudience();
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(opts.subject)
    .setJti(opts.jti)
    .setIssuedAt()
    .setExpirationTime(`${opts.expiresInS}s`)
    .sign(secretKey());
}

export async function verifyUnderwriteJwt(token: string): Promise<jose.JWTPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(), {
    algorithms: ["HS256"],
    audience: apiAudience(),
  });
  return payload;
}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

function auth0Jwks() {
  if (!env.auth0.domain) return null;
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(`https://${env.auth0.domain}/.well-known/jwks.json`));
  }
  return jwks;
}

export async function verifyAuth0AccessToken(token: string): Promise<jose.JWTPayload> {
  const keys = auth0Jwks();
  if (!keys || !env.auth0.domain) throw new Error("auth0 is not configured");
  const issuer = [`https://${env.auth0.domain}/`, `https://${env.auth0.domain}`];
  const { payload } = await jose.jwtVerify(token, keys, {
    issuer,
    audience: env.auth0.audience,
  });
  return payload;
}

function scopesFromPayload(payload: jose.JWTPayload): string[] {
  const scopes = new Set<string>([
    ...parseScopeList(payload.scope),
    ...parseScopeList(payload.permissions),
    ...parseScopeList(payload.scp),
  ]);
  const claims = asRecord(payload);
  if (isAdminUser({ userId: typeof payload.sub === "string" ? payload.sub : null, claims, roles: rolesFromClaims(claims) })) {
    scopes.add(ADMIN_SCOPE);
  }
  return [...scopes];
}

function audienceMatches(payload: jose.JWTPayload, expected: string): boolean {
  const aud = payload.aud;
  if (aud === expected) return true;
  return Array.isArray(aud) && aud.includes(expected);
}

export async function verifyAccessToken(token: string): Promise<UnderwriteAccessClaims | null> {
  try {
    const payload = await verifyUnderwriteJwt(token);
    if (payload.token_use === "identity_assertion") return null;
    if (payload.token_use && payload.token_use !== "access") return null;
    if (!audienceMatches(payload, apiAudience())) return null;
    const scopes = scopesFromPayload(payload);
    const owner = typeof payload.owner_user_id === "string" ? payload.owner_user_id : undefined;
    const agentId = typeof payload.agent_id === "string" ? payload.agent_id : undefined;
    const registrationId = typeof payload.registration_id === "string" ? payload.registration_id : undefined;
    return {
      iss: String(payload.iss ?? ""),
      aud: apiAudience(),
      sub: String(payload.sub ?? ""),
      jti: String(payload.jti ?? ""),
      exp: Number(payload.exp ?? 0),
      iat: Number(payload.iat ?? 0),
      token_use: "access",
      scope: scopes.join(" "),
      scopes,
      registration_id: registrationId,
      owner_user_id: owner,
      agent_id: agentId,
      source: "underwrite",
    };
  } catch {
    // Fall through to Auth0 JWKS.
  }

  if (!env.auth0.enabled || !env.auth0.audienceConfigured) return null;
  try {
    const payload = await verifyAuth0AccessToken(token);
    const scopes = scopesFromPayload(payload);
    return {
      iss: String(payload.iss ?? ""),
      aud: apiAudience(),
      sub: String(payload.sub ?? ""),
      jti: String(payload.jti ?? ""),
      exp: Number(payload.exp ?? 0),
      iat: Number(payload.iat ?? 0),
      token_use: "access",
      scope: scopes.join(" "),
      scopes,
      owner_user_id: typeof payload.sub === "string" ? payload.sub : undefined,
      source: "auth0",
    };
  } catch {
    return null;
  }
}

export async function verifyIdentityAssertion(token: string): Promise<IdentityAssertionClaims | null> {
  try {
    const payload = await verifyUnderwriteJwt(token);
    if (payload.token_use !== "identity_assertion") return null;
    if (typeof payload.registration_id !== "string") return null;
    return {
      iss: String(payload.iss ?? ""),
      aud: apiAudience(),
      sub: String(payload.sub ?? ""),
      jti: String(payload.jti ?? ""),
      exp: Number(payload.exp ?? 0),
      iat: Number(payload.iat ?? 0),
      token_use: "identity_assertion",
      registration_id: payload.registration_id,
      registration_type: String(payload.registration_type ?? ""),
      claimed: payload.claimed === true,
      scopes: parseScopeList(payload.scopes),
      owner_user_id: typeof payload.owner_user_id === "string" ? payload.owner_user_id : undefined,
      agent_id: typeof payload.agent_id === "string" ? payload.agent_id : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}
