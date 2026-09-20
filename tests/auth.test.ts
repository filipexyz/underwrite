/**
 * API-key hashing, buyer/seller auth helper, admin guard, disabled-agent hire filter.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { isAdminUser, parseAdminAllowlist } from "@/lib/auth/admin";
import {
  extractPresentedKey,
  generateApiKeySecret,
  hashApiKey,
  issueApiKey,
  lookupApiKey,
  resolveBuyerAuth,
  resolveSellerAuth,
  revokeApiKey,
} from "@/lib/auth/api-keys";
import { openDb, type Db } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { seed, TASK_CATEGORY } from "@/lib/db/seed";
import { loadRegistry } from "@/lib/marketplace/registry";
import { registerSellerAgent, setAgentStatus } from "@/lib/marketplace/sellers";

let db: Db;

beforeAll(async () => {
  const handle = await openDb("pglite://memory");
  await handle.migrate();
  await seed(handle.db);
  db = handle.db;
});

describe("hashApiKey / generateApiKeySecret", () => {
  it("stores SHA-256 hex of the secret and never the secret itself", () => {
    const secret = "uw_buyer_test-secret";
    const hash = hashApiKey(secret);
    expect(hash).toBe(createHash("sha256").update(secret, "utf8").digest("hex"));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(secret);
    expect(hashApiKey(secret)).toBe(hash);
    expect(hashApiKey("uw_buyer_other")).not.toBe(hash);
  });

  it("mints a role-prefixed secret whose prefix is a public slice of it", () => {
    const { secret, prefix } = generateApiKeySecret("buyer");
    expect(secret.startsWith("uw_buyer_")).toBe(true);
    expect(secret.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBe(18);
  });
});

describe("admin guard (Auth0 claims + allowlist)", () => {
  it("treats https://underwrite/roles admin as admin", () => {
    expect(isAdminUser({ userId: "auth0|1", claims: { "https://underwrite/roles": ["admin"] } }, [])).toBe(true);
  });

  it("treats app_metadata.admin === true as admin", () => {
    expect(isAdminUser({ userId: "auth0|1", claims: { app_metadata: { admin: true } } }, [])).toBe(true);
  });

  it("accepts the optional Auth0 sub allowlist as a bootstrap", () => {
    expect(isAdminUser({ userId: "auth0|2", claims: {} }, ["auth0|2"])).toBe(true);
    expect(parseAdminAllowlist(" auth0|a, auth0|b ")).toEqual(["auth0|a", "auth0|b"]);
  });

  it("rejects ordinary signed-in users", () => {
    expect(isAdminUser({ userId: "auth0|1", claims: { role: "member" } }, ["auth0|other"])).toBe(false);
    expect(isAdminUser({ userId: null, claims: { "https://underwrite/roles": ["admin"] } }, [])).toBe(true);
    expect(isAdminUser({ userId: "auth0|1", claims: {} }, [])).toBe(false);
  });
});

describe("extractPresentedKey", () => {
  it("reads Bearer or x-api-key", () => {
    expect(extractPresentedKey(new Headers({ authorization: "Bearer  abc " }))).toBe("abc");
    expect(extractPresentedKey(new Headers({ "x-api-key": "xyz" }))).toBe("xyz");
    expect(extractPresentedKey(new Headers())).toBeNull();
  });
});

describe("resolveBuyerAuth / resolveSellerAuth", () => {
  it("keeps /api/v1/requests public when no legacy env and no presented key", async () => {
    const result = await resolveBuyerAuth({ presented: null, legacyKey: undefined, db });
    expect(result).toEqual({ ok: true, auth: { kind: "public" } });
  });

  it("requires a presented key when the legacy env is set", async () => {
    const denied = await resolveBuyerAuth({ presented: null, legacyKey: "legacy-secret", db });
    expect(denied).toEqual({ ok: false, status: 401, error: "missing or invalid API key" });
    const ok = await resolveBuyerAuth({ presented: "legacy-secret", legacyKey: "legacy-secret", db });
    expect(ok).toEqual({ ok: true, auth: { kind: "legacy" } });
  });

  it("accepts a non-revoked hashed buyer key and records last_used_at", async () => {
    const issued = await issueApiKey(db, { name: "t-buyer", role: "buyer", ownerUserId: "user_test" });
    const stored = await lookupApiKey(db, issued.secret);
    expect(stored?.keyHash).toBe(hashApiKey(issued.secret));
    expect(JSON.stringify(stored)).not.toContain(issued.secret);

    const result = await resolveBuyerAuth({ presented: issued.secret, legacyKey: undefined, db });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.auth.kind).toBe("key");

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, issued.row.id));
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });

  it("rejects a seller key on buyer routes and a revoked buyer key", async () => {
    const seller = await issueApiKey(db, {
      name: "t-seller-orphan",
      role: "seller",
      ownerUserId: "user_test",
      agentId: "c2-honest",
    });
    const forbidden = await resolveBuyerAuth({ presented: seller.secret, legacyKey: undefined, db });
    expect(forbidden).toEqual({ ok: false, status: 403, error: "this key cannot access buyer request routes" });

    const buyer = await issueApiKey(db, { name: "t-revoked", role: "buyer", ownerUserId: "user_test" });
    await revokeApiKey(db, buyer.row.id);
    const revoked = await resolveBuyerAuth({ presented: buyer.secret, legacyKey: undefined, db });
    expect(revoked).toEqual({ ok: false, status: 401, error: "missing or invalid API key" });
  });

  it("accepts a seller key only for the bound agent", async () => {
    const created = await registerSellerAgent(db, "user_seller", {
      name: "Northwind",
      role: "executor",
      specialties: ["html_to_pdf"],
      model_family: "family-test",
      model: "auto",
      baseline_confidence: 0.9,
      cost_ceiling_usd: 0.04,
      latency_class: "mid",
      risk_tolerance: "mid",
    });
    const ok = await resolveSellerAuth({ presented: created.secret, db });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.agentId).toBe(created.agent.agentId);

    const buyer = await issueApiKey(db, { name: "not-seller", role: "buyer", ownerUserId: "user_seller" });
    const denied = await resolveSellerAuth({ presented: buyer.secret, db });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(401);
  });
});

describe("hireable registry", () => {
  it("hides disabled agents from discovery but keeps the seed catalog", async () => {
    await setAgentStatus(db, "c1-cheap", "disabled");
    const registry = await loadRegistry(db, TASK_CATEGORY);
    expect(registry.agents.has("c1-cheap")).toBe(false);
    expect(registry.agents.has("a-delegator")).toBe(true);
    await setAgentStatus(db, "c1-cheap", "seed");
  });
});
