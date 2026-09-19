/**
 * Clerk session helpers for human pages and account/admin APIs.
 * Without Clerk keys the app treats the caller as `local-dev` (same as the open console).
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { forbidden, unauthorized } from "next/navigation";
import { NextResponse } from "next/server";
import { isAdminUser, metadataFromSessionClaims, publicMetadataRecord } from "@/lib/auth/admin";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { ensureUserWallet } from "@/lib/marketplace/credits";

export const LOCAL_DEV_USER_ID = "local-dev";

export type SessionIdentity = {
  userId: string;
  admin: boolean;
  publicMetadata: Record<string, unknown>;
};

async function readClerkIdentity(): Promise<{ userId: string | null; publicMetadata: Record<string, unknown> }> {
  const { userId, sessionClaims } = await auth();
  const user = await currentUser();
  const publicMetadata = {
    ...metadataFromSessionClaims(sessionClaims),
    ...publicMetadataRecord(user?.publicMetadata),
  };
  return { userId: userId ?? user?.id ?? null, publicMetadata };
}

export async function resolveSessionIdentity(): Promise<SessionIdentity | null> {
  if (!env.clerk.enabled) {
    const { db } = await getDb();
    await ensureUserWallet(db, LOCAL_DEV_USER_ID);
    return { userId: LOCAL_DEV_USER_ID, admin: true, publicMetadata: { role: "admin" } };
  }
  const { userId, publicMetadata } = await readClerkIdentity();
  if (!userId) return null;
  const { db } = await getDb();
  await ensureUserWallet(db, userId);
  return {
    userId,
    admin: isAdminUser({ userId, publicMetadata }),
    publicMetadata,
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
  if (!identity) return { ok: false, response: jsonError(401, "unauthorized") };
  return { ok: true, identity };
}

export async function requireAdminApi(): Promise<{ ok: true; identity: SessionIdentity } | { ok: false; response: NextResponse }> {
  const signedIn = await requireSignedInApi();
  if (!signedIn.ok) return signedIn;
  if (!signedIn.identity.admin) return { ok: false, response: jsonError(403, "forbidden") };
  return signedIn;
}
