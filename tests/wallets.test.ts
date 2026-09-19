/**
 * Test credits: Clerk users start at $1000. Registered agents start at $0
 * and earn by being hired. Buyer debit on lock.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as postRequest } from "@/app/api/v1/requests/route";
import { issueApiKey } from "@/lib/auth/api-keys";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import { getDb, openDb, type Db } from "@/lib/db/client";
import { wallets } from "@/lib/db/schema";
import { seed } from "@/lib/db/seed";
import {
  STARTING_AGENT_CREDITS_USD,
  STARTING_TEST_CREDITS_USD,
  classifyWallet,
  ensureAgentWallet,
  ensureUserWallet,
  getWallet,
} from "@/lib/marketplace/credits";
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
    const first = await ensureUserWallet(db, "user_credits");
    expect(first.capitalUsd).toBe(1000);
    expect(STARTING_TEST_CREDITS_USD).toBe(1000);
    await db.update(wallets).set({ capitalUsd: 50 }).where(eq(wallets.ownerId, "user_credits"));
    const again = await ensureUserWallet(db, "user_credits");
    expect(again.capitalUsd).toBe(50);
  });

  it("classifies user, agent, and system wallets", () => {
    expect(classifyWallet("user_abc", ["agt_1"])).toBe("user");
    expect(classifyWallet("agt_1", ["agt_1"])).toBe("agent");
    expect(classifyWallet(SYSTEM_WALLETS.buyer, ["agt_1"])).toBe("system");
    expect(classifyWallet(SYSTEM_WALLETS.escrow, [])).toBe("system");
  });

  it("ensureAgentWallet starts at $0 and never resets an earned balance", async () => {
    const first = await ensureAgentWallet(db, "agt_orphan_wallet");
    expect(first.capitalUsd).toBe(STARTING_AGENT_CREDITS_USD);
    expect(first.capitalUsd).toBe(0);
    await db.update(wallets).set({ capitalUsd: 12 }).where(eq(wallets.ownerId, "agt_orphan_wallet"));
    const again = await ensureAgentWallet(db, "agt_orphan_wallet");
    expect(again.capitalUsd).toBe(12);
  });

  it("gives a registered seller a $0 wallet (seed wallets stay catalog values)", async () => {
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
    expect(agentWallet?.capitalUsd).toBe(0);
    const seedA = await getWallet(db, "a-delegator");
    expect(seedA?.capitalUsd).toBe(1);
  });

  it("does not grant $1000 when a registered-agent wallet already exists at $0", async () => {
    await db.insert(wallets).values({ ownerId: "agt_prezero", capitalUsd: 0, riskTolerance: "mid" });
    const healed = await ensureAgentWallet(db, "agt_prezero");
    expect(healed.capitalUsd).toBe(0);
  });

  it("debits the buyer user wallet through escrow and leaves the system buyer wallet alone", async () => {
    // `runMarketplace` uses the process-wide getDb() handle, which is a seed-only catalog.
    const { db: shared } = await getDb();
    await ensureUserWallet(shared, "user_pay");
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

  it("returns 402 when a buyer-key owner cannot cover max_cost_usd", async () => {
    const { db: shared } = await getDb();
    await ensureUserWallet(shared, "user_broke");
    await shared.update(wallets).set({ capitalUsd: 0.001 }).where(eq(wallets.ownerId, "user_broke"));
    const issued = await issueApiKey(shared, {
      name: "broke buyer",
      role: "buyer",
      ownerClerkUserId: "user_broke",
      scopes: ["requests:write"],
    });
    const response = await postRequest(
      new Request("http://localhost/api/v1/requests", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          task: { requirement: "too expensive for this wallet", files: [] },
          max_cost_usd: 0.05,
          max_latency_s: 30,
          min_confidence: 0.95,
        }),
      }),
    );
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: string; details: { balance_usd: number; required_usd: number } };
    expect(body.error).toBe("insufficient wallet balance");
    expect(body.details.balance_usd).toBe(0.001);
    expect(body.details.required_usd).toBe(0.05);
  });
});
