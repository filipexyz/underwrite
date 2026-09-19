/**
 * $1000 test credits: user wallets, registered-agent wallets, buyer debit on lock.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import { getDb, openDb, type Db } from "@/lib/db/client";
import { wallets } from "@/lib/db/schema";
import { seed } from "@/lib/db/seed";
import { STARTING_TEST_CREDITS_USD, ensureWallet, getWallet } from "@/lib/marketplace/credits";
import { createRequest, DEMO_REQUEST } from "@/lib/marketplace/requests";
import { registerSellerAgent } from "@/lib/marketplace/sellers";
import { runMarketplace } from "@/mastra";

let db: Db;

beforeAll(async () => {
  const handle = await openDb("pglite://memory");
  await handle.migrate();
  await seed(handle.db);
  db = handle.db;
});

describe("test-credit wallets", () => {
  it("creates a user wallet at $1000 and never resets an existing balance", async () => {
    const first = await ensureWallet(db, "user_credits", STARTING_TEST_CREDITS_USD);
    expect(first.capitalUsd).toBe(1000);
    await db.update(wallets).set({ capitalUsd: 50 }).where(eq(wallets.ownerId, "user_credits"));
    const again = await ensureWallet(db, "user_credits", STARTING_TEST_CREDITS_USD);
    expect(again.capitalUsd).toBe(50);
  });

  it("gives a registered seller a $1000 wallet (seed wallets stay catalog values)", async () => {
    const created = await registerSellerAgent(db, "user_seller_wallet", {
      name: "Credit seller",
      role: "executor",
      specialties: ["html_to_pdf"],
      model_family: "family-credit",
      model: "auto",
      baseline_confidence: 0.9,
      cost_ceiling_usd: 0.04,
      latency_class: "mid",
      risk_tolerance: "mid",
    });
    const agentWallet = await getWallet(db, created.agent.agentId);
    expect(agentWallet?.capitalUsd).toBe(1000);
    const seedA = await getWallet(db, "a-delegator");
    expect(seedA?.capitalUsd).toBe(1);
  });

  it("debits the buyer user wallet through escrow and leaves the system buyer wallet alone", async () => {
    // `runMarketplace` uses the process-wide getDb() handle, which is a seed-only catalog.
    const { db: shared } = await getDb();
    await ensureWallet(shared, "user_pay", STARTING_TEST_CREDITS_USD);
    const systemBefore = await getWallet(shared, SYSTEM_WALLETS.buyer);
    const row = await createRequest(shared, DEMO_REQUEST, {
      actor: "agent",
      source: "tests/wallets",
      buyerWalletId: "user_pay",
    });
    const outcome = await runMarketplace(row.requestId);
    expect(outcome.status).toBe("success");
    const userAfter = await getWallet(shared, "user_pay");
    const systemAfter = await getWallet(shared, SYSTEM_WALLETS.buyer);
    expect(systemAfter?.capitalUsd).toBe(systemBefore?.capitalUsd);
    expect(userAfter!.capitalUsd).toBeLessThan(STARTING_TEST_CREDITS_USD);
    expect(userAfter!.capitalUsd).toBeGreaterThan(990);
  });
});
