/**
 * Owner-only agent management and disabled-agent marketplace eligibility.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getOwnedAgentApi, PATCH as patchOwnedAgentApi } from "@/app/api/account/agents/[id]/route";
import { PATCH as patchOwnedAgentsCollection } from "@/app/api/account/agents/route";
import { LOCAL_DEV_USER_ID } from "@/lib/auth/session";
import { getDb, openDb, type Db } from "@/lib/db/client";
import { bids } from "@/lib/db/schema";
import { seed, TASK_CATEGORY } from "@/lib/db/seed";
import { runAuction } from "@/lib/marketplace/engine";
import { createRequest, DEMO_REQUEST } from "@/lib/marketplace/requests";
import { discover, isHireableAgent, loadRegistry } from "@/lib/marketplace/registry";
import {
  getOwnedAgent,
  patchOwnedAgent,
  registerSellerAgent,
  setAgentStatus,
} from "@/lib/marketplace/sellers";

let db: Db;

const draft = {
  name: "Owned renderer",
  role: "executor" as const,
  specialties: ["html_to_pdf"],
  model_family: "family-owner",
  model: "auto",
  baseline_confidence: 0.9,
  cost_ceiling_usd: 0.04,
  latency_class: "mid" as const,
  risk_tolerance: "mid" as const,
  description: "owner-managed test agent",
};

beforeAll(async () => {
  const handle = await openDb("pglite://memory");
  await handle.migrate();
  await seed(handle.db);
  db = handle.db;
});

describe("ownership checks", () => {
  it("getOwnedAgent and patchOwnedAgent only succeed for the owner", async () => {
    const created = await registerSellerAgent(db, "user_owner", draft);
    const owned = await getOwnedAgent(db, created.agent.agentId, "user_owner");
    expect(owned?.agentId).toBe(created.agent.agentId);
    expect(owned?.description).toBe("owner-managed test agent");

    const stranger = await getOwnedAgent(db, created.agent.agentId, "user_other");
    expect(stranger).toBeNull();

    const refused = await patchOwnedAgent(db, created.agent.agentId, "user_other", { name: "Hijacked" });
    expect(refused).toBeNull();
    const after = await getOwnedAgent(db, created.agent.agentId, "user_owner");
    expect(after?.name).toBe("Owned renderer");

    const updated = await patchOwnedAgent(db, created.agent.agentId, "user_owner", { name: "Renamed" });
    expect(updated?.name).toBe("Renamed");
  });

  it("account APIs 404 when the session user does not own the agent", async () => {
    // Route handlers use the process-wide getDb() handle (Clerk off → local-dev).
    const { db: shared } = await getDb();
    const foreign = await registerSellerAgent(shared, "user_foreign", { ...draft, name: "Foreign" });
    const mine = await registerSellerAgent(shared, LOCAL_DEV_USER_ID, { ...draft, name: "Local" });

    const deniedGet = await getOwnedAgentApi(new Request("http://local/api/account/agents/x"), {
      params: Promise.resolve({ id: foreign.agent.agentId }),
    });
    expect(deniedGet.status).toBe(404);

    const deniedPatch = await patchOwnedAgentApi(
      new Request("http://local/api/account/agents/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "nope" }),
      }),
      { params: Promise.resolve({ id: foreign.agent.agentId }) },
    );
    expect(deniedPatch.status).toBe(404);

    const deniedCollection = await patchOwnedAgentsCollection(
      new Request("http://local/api/account/agents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: foreign.agent.agentId, name: "nope" }),
      }),
    );
    expect(deniedCollection.status).toBe(404);

    const ok = await patchOwnedAgentApi(
      new Request("http://local/api/account/agents/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Local renamed", status: "disabled" }),
      }),
      { params: Promise.resolve({ id: mine.agent.agentId }) },
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { agent: { name: string; status: string } };
    expect(body.agent.name).toBe("Local renamed");
    expect(body.agent.status).toBe("disabled");
    expect(isHireableAgent(body.agent)).toBe(false);
  });
});

describe("disable eligibility", () => {
  it("hides a disabled owned agent from registry discovery and auction bids", async () => {
    const created = await registerSellerAgent(db, "user_disable", {
      ...draft,
      name: "Soon disabled",
      specialties: ["html_to_pdf"],
    });

    const before = await loadRegistry(db, TASK_CATEGORY);
    expect(before.agents.has(created.agent.agentId)).toBe(true);
    expect(discover(before, { specialty: TASK_CATEGORY }).some((a) => a.agentId === created.agent.agentId)).toBe(true);

    const disabled = await patchOwnedAgent(db, created.agent.agentId, "user_disable", { status: "disabled" });
    expect(disabled?.status).toBe("disabled");
    expect(isHireableAgent(disabled!)).toBe(false);

    const after = await loadRegistry(db, TASK_CATEGORY);
    expect(after.agents.has(created.agent.agentId)).toBe(false);
    expect(discover(after, { specialty: TASK_CATEGORY }).some((a) => a.agentId === created.agent.agentId)).toBe(false);

    const request = await createRequest(db, DEMO_REQUEST, { actor: "agent", source: "tests/sellers" });
    await runAuction(db, request.requestId);
    const auctionBids = await db.select().from(bids).where(eq(bids.requestId, request.requestId));
    expect(auctionBids.some((bid) => bid.agentId === created.agent.agentId)).toBe(false);

    await setAgentStatus(db, created.agent.agentId, "registered");
    const reenabled = await loadRegistry(db, TASK_CATEGORY);
    expect(reenabled.agents.has(created.agent.agentId)).toBe(true);
  });
});
