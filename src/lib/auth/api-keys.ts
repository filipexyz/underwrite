/**
 * Hashed API keys. The plaintext secret is shown once at create time.
 *
 * Request auth accepts either the legacy env `UNDERWRITE_API_KEY` or a
 * non-revoked DB key. `/api/v1/requests*` needs a buyer (or admin_service)
 * key; `/api/v1/agents/me` needs a seller key tied to an agent.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { apiKeys, type ApiKeyRole, type ApiKeyRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

export type BuyerAuth = { kind: "public" } | { kind: "legacy" } | { kind: "key"; key: ApiKeyRow };

export type AuthFailure = { ok: false; status: number; error: string };

export type PublicApiKey = {
  id: string;
  name: string;
  role: ApiKeyRole;
  key_prefix: string;
  owner_clerk_user_id: string | null;
  agent_id: string | null;
  scopes: string[];
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiKeySecret(role: ApiKeyRole): { secret: string; prefix: string } {
  const secret = `uw_${role}_${randomBytes(24).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 18) };
}

export function extractPresentedKey(headers: Headers): string | null {
  const header = headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const raw = bearer || (headers.get("x-api-key") ?? "").trim();
  return raw.length > 0 ? raw : null;
}

export function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function lookupApiKey(db: Db, secret: string): Promise<ApiKeyRow | null> {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashApiKey(secret))).limit(1);
  return row ?? null;
}

export async function touchApiKey(db: Db, id: string): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
}

export async function resolveBuyerAuth(opts: {
  presented: string | null;
  legacyKey: string | undefined;
  db: Db;
}): Promise<{ ok: true; auth: BuyerAuth } | AuthFailure> {
  const { presented, legacyKey, db } = opts;
  if (presented && legacyKey && secretsMatch(presented, legacyKey)) {
    return { ok: true, auth: { kind: "legacy" } };
  }
  if (presented) {
    const row = await lookupApiKey(db, presented);
    if (!row || row.revokedAt) return { ok: false, status: 401, error: "missing or invalid API key" };
    if (row.role !== "buyer" && row.role !== "admin_service") {
      return { ok: false, status: 403, error: "this key cannot access buyer request routes" };
    }
    await touchApiKey(db, row.id);
    return { ok: true, auth: { kind: "key", key: row } };
  }
  if (legacyKey) return { ok: false, status: 401, error: "missing or invalid API key" };
  return { ok: true, auth: { kind: "public" } };
}

export async function resolveSellerAuth(opts: {
  presented: string | null;
  db: Db;
}): Promise<{ ok: true; key: ApiKeyRow; agentId: string } | AuthFailure> {
  const { presented, db } = opts;
  if (!presented) return { ok: false, status: 401, error: "missing or invalid API key" };
  const row = await lookupApiKey(db, presented);
  if (!row || row.revokedAt || row.role !== "seller" || !row.agentId) {
    return { ok: false, status: 401, error: "missing or invalid API key" };
  }
  await touchApiKey(db, row.id);
  return { ok: true, key: row, agentId: row.agentId };
}

export async function issueApiKey(
  db: Db,
  args: {
    name: string;
    role: ApiKeyRole;
    ownerClerkUserId?: string | null;
    agentId?: string | null;
    scopes?: string[];
  },
): Promise<{ row: ApiKeyRow; secret: string }> {
  const { secret, prefix } = generateApiKeySecret(args.role);
  const [row] = await db
    .insert(apiKeys)
    .values({
      id: newId("key"),
      name: args.name.trim() || `${args.role} key`,
      role: args.role,
      keyPrefix: prefix,
      keyHash: hashApiKey(secret),
      ownerClerkUserId: args.ownerClerkUserId ?? null,
      agentId: args.agentId ?? null,
      scopes: args.scopes ?? [],
    })
    .returning();
  return { row, secret };
}

export async function revokeApiKey(db: Db, id: string): Promise<ApiKeyRow | null> {
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)).returning();
  return row ?? null;
}

export async function listApiKeys(
  db: Db,
  filter?: { ownerClerkUserId?: string; agentId?: string },
): Promise<ApiKeyRow[]> {
  const conditions = [];
  if (filter?.ownerClerkUserId) conditions.push(eq(apiKeys.ownerClerkUserId, filter.ownerClerkUserId));
  if (filter?.agentId) conditions.push(eq(apiKeys.agentId, filter.agentId));
  if (conditions.length === 0) {
    return db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  }
  return db
    .select()
    .from(apiKeys)
    .where(and(...conditions))
    .orderBy(desc(apiKeys.createdAt));
}

export function toPublicApiKey(row: ApiKeyRow): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    key_prefix: row.keyPrefix,
    owner_clerk_user_id: row.ownerClerkUserId,
    agent_id: row.agentId,
    scopes: row.scopes,
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}
