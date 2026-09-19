/**
 * Auth0 session helpers for human pages and account/admin APIs.
 * Without Auth0 keys the app treats the caller as `local-dev` (same as the open console).
 */
import { forbidden, unauthorized } from "next/navigation";
import { NextResponse } from "next/server";
import { isAdminUser, rolesFromClaims, asRecord } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { ensureUserWallet } from "@/lib/marketplace/credits";

function apiError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export const LOCAL_DEV_USER_ID = "local-dev";

export type SessionIdentity = {
  userId: string;
  email?: string;
  admin: boolean;
  roles: string[];
  claims: Record<string, unknown>;
};

async function readAuth0Identity(): Promise<{
  userId: string | null;
  email?: string;
  claims: Record<string, unknown>;
}> {
  const { getAuth0 } = await import("@/lib/auth0");
  const client = getAuth0();
  if (!client) return { userId: null, claims: {} };
  const session = await client.getSession();
  const user = session?.user;
  if (!user?.sub) return { userId: null, claims: {} };
  return {
    userId: user.sub,
    email: typeof user.email === "string" ? user.email : undefined,
    claims: asRecord(user),
  };
}

export async function resolveSessionIdentity(): Promise<SessionIdentity | null> {
  if (!env.auth0.enabled) {
    const { db } = await getDb();
    await ensureUserWallet(db, LOCAL_DEV_USER_ID);
    return {
      userId: LOCAL_DEV_USER_ID,
      email: undefined,
      admin: true,
      roles: ["admin"],
      claims: { [ "https://underwrite/roles" as const]: ["admin"] },
    };
  }
  const { userId, email, claims } = await readAuth0Identity();
  if (!userId) return null;
  const { db } = await getDb();
  await ensureUserWallet(db, userId);
  const roles = rolesFromClaims(claims);
  return {
    userId,
    email,
    admin: isAdminUser({ userId, roles, claims }),
    roles,
    claims,
  };
}

export async function requireSignedInPage(): Promise<SessionIdentity> {
  const identity = await resolveSessionIdentity();
  if (!identity) unauthorized();
  return identity;
}

export async function requireAdminPage(): Promise<SessionIdentity> {
  const identity = await requireSignedInPage();
  if (!identity.admin) forbidden();
  return identity;
}

export async function requireSignedInApi(): Promise<{ ok: true; identity: SessionIdentity } | { ok: false; response: NextResponse }> {
  const identity = await resolveSessionIdentity();
  if (!identity) return { ok: false, response: apiError(401, "unauthorized") };
  return { ok: true, identity };
}

export async function requireAdminApi(): Promise<{ ok: true; identity: SessionIdentity } | { ok: false; response: NextResponse }> {
  const signedIn = await requireSignedInApi();
  if (!signedIn.ok) return signedIn;
  if (!signedIn.identity.admin) return { ok: false, response: apiError(403, "forbidden") };
  return signedIn;
}
