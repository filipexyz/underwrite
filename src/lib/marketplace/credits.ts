/**
 * Test credits. No real money. Clerk users and registered seller agents
 * start at $1000; the seeded A/B/C1/C2/J1/J2 wallets stay as catalog data.
 */
import { eq } from "drizzle-orm";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { wallets, type WalletRow } from "@/lib/db/schema";

export const STARTING_TEST_CREDITS_USD = 1000;

const SYSTEM_OWNER_IDS = new Set<string>(Object.values(SYSTEM_WALLETS));

export type WalletKind = "user" | "agent" | "system";

export function buyerWalletId(request: { buyerWalletId?: string | null }): string {
  return request.buyerWalletId ?? SYSTEM_WALLETS.buyer;
}

export function classifyWallet(ownerId: string, agentIds: Iterable<string>): WalletKind {
  if (SYSTEM_OWNER_IDS.has(ownerId)) return "system";
  const known = agentIds instanceof Set ? agentIds : new Set(agentIds);
  if (known.has(ownerId)) return "agent";
  return "user";
}

export async function getWallet(db: Db, ownerId: string): Promise<WalletRow | null> {
  const [row] = await db.select().from(wallets).where(eq(wallets.ownerId, ownerId)).limit(1);
  return row ?? null;
}

/** Idempotent: creates the wallet at `startingUsd` if missing, never resets an existing balance. */
export async function ensureWallet(
  db: Db,
  ownerId: string,
  startingUsd: number = STARTING_TEST_CREDITS_USD,
): Promise<WalletRow> {
  const existing = await getWallet(db, ownerId);
  if (existing) return existing;
  const [inserted] = await db
    .insert(wallets)
    .values({ ownerId, capitalUsd: startingUsd, riskTolerance: "mid" })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const raced = await getWallet(db, ownerId);
  if (!raced) throw new Error(`wallet vanished: ${ownerId}`);
  return raced;
}

/** Clerk user (or `local-dev`) wallet keyed by that id in `wallets.owner_id`. */
export function ensureUserWallet(db: Db, clerkUserId: string): Promise<WalletRow> {
  return ensureWallet(db, clerkUserId, STARTING_TEST_CREDITS_USD);
}

/** Registered seller agent wallet. Seed catalog wallets are left alone. */
export function ensureAgentWallet(db: Db, agentId: string): Promise<WalletRow> {
  return ensureWallet(db, agentId, STARTING_TEST_CREDITS_USD);
}

export async function listWallets(db: Db): Promise<WalletRow[]> {
  return db.select().from(wallets);
}
