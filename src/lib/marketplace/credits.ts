/**
 * Test credits. No real money.
 *
 * Clerk users (and `local-dev`) start at $1000. Registered seller agents
 * start at $0 and earn by being hired. Seed catalog wallets stay as
 * A/B/C1/C2/J1/J2 data and are never granted or healed to $1000.
 */
import { eq } from "drizzle-orm";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { wallets, type WalletRow } from "@/lib/db/schema";

/** Clerk user / `local-dev` starting grant. Agents do not receive this. */
export const STARTING_TEST_CREDITS_USD = 1000;

/** Registered seller agents start empty and earn by being hired. */
export const STARTING_AGENT_CREDITS_USD = 0;

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

/** Registered seller agent wallet at $0 if missing. Never grants $1000. Never resets an existing balance. */
export function ensureAgentWallet(db: Db, agentId: string): Promise<WalletRow> {
  return ensureWallet(db, agentId, STARTING_AGENT_CREDITS_USD);
}

export async function listWallets(db: Db): Promise<WalletRow[]> {
  return db.select().from(wallets);
}
