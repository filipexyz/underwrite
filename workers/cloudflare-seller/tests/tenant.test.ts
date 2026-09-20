import { describe, expect, it } from "vitest";
import { authorizeRuntime, parseSellerPath, resolveWebhookAgentId } from "../src/routes";
import { credentialsFromProvision, mergeSellerConfig } from "../src/tenant";
import { signWebhookBody, verifyWebhookSignature } from "../src/webhook";

describe("parseSellerPath", () => {
  it("routes health, per-agent webhook, provision, and inbox drain", () => {
    expect(parseSellerPath("/health")).toEqual({ kind: "health" });
    expect(parseSellerPath("/webhook")).toEqual({ kind: "legacy_webhook" });
    expect(parseSellerPath("/webhook/agt_user_a")).toEqual({ kind: "agent_webhook", agentId: "agt_user_a" });
    expect(parseSellerPath("/internal/agents/agt_user_a")).toEqual({ kind: "provision", agentId: "agt_user_a" });
    expect(parseSellerPath("/inbox/drain")).toEqual({ kind: "inbox_drain" });
    expect(parseSellerPath("/inbox/drain/agt_user_b")).toEqual({ kind: "inbox_drain", agentId: "agt_user_b" });
  });
});

describe("resolveWebhookAgentId", () => {
  it("rejects a path/header mismatch (isolation)", () => {
    const denied = resolveWebhookAgentId("agt_a", "agt_b", "default");
    expect(denied.ok).toBe(false);
    const ok = resolveWebhookAgentId("agt_a", "agt_a", "default");
    expect(ok).toEqual({ ok: true, agentId: "agt_a" });
  });
});

describe("tenant credentials", () => {
  it("prefers the Durable Object copy over the deprecated global env", () => {
    const env = {
      UNDERWRITE_BASE_URL: "http://localhost:3000",
      UNDERWRITE_SELLER_API_KEY: "uw_seller_GLOBAL",
      UNDERWRITE_WEBHOOK_SECRET: "global-secret",
      NEURALAKE_API_KEY: "global-nl",
      NEURALAKE_BASE_URL: "https://api.neuralake.cloud/v1",
      NEURALAKE_MODEL: "auto",
      SELLER_INSTANCE_NAME: "default",
    } as Env;
    const merged = mergeSellerConfig(
      env,
      {
        sellerApiKey: "uw_seller_AGENT_A",
        webhookSecret: "whsec_A",
        neuralakeApiKey: "nl_A",
      },
      "agt_a",
    );
    expect(merged.sellerApiKey).toBe("uw_seller_AGENT_A");
    expect(merged.webhookSecret).toBe("whsec_A");
    expect(merged.neuralakeApiKey).toBe("nl_A");
    expect(merged.instanceName).toBe("agt_a");
  });

  it("parses a provision payload without leaking empty strings", () => {
    expect(
      credentialsFromProvision({
        seller_api_key: "uw_seller_x",
        webhook_secret: "whsec_x",
        byok_api_key: "",
        byok_base_url: null,
      }),
    ).toEqual({
      sellerApiKey: "uw_seller_x",
      webhookSecret: "whsec_x",
      neuralakeApiKey: undefined,
      neuralakeBaseUrl: undefined,
      neuralakeModel: undefined,
      underwriteBaseUrl: undefined,
    });
  });
});

describe("per-agent HMAC isolation", () => {
  it("agent B’s secret cannot verify a body signed with agent A’s secret", async () => {
    const body = JSON.stringify({ type: "plan_request", job_id: "req_1" });
    const timestamp = "1710000000000";
    const signature = await signWebhookBody(body, timestamp, "whsec_A");
    expect(await verifyWebhookSignature({ body, timestamp, signature: `sha256=${signature}`, secret: "whsec_A" })).toBe(
      true,
    );
    expect(await verifyWebhookSignature({ body, timestamp, signature: `sha256=${signature}`, secret: "whsec_B" })).toBe(
      false,
    );
  });
});

describe("runtime secret", () => {
  it("rejects a missing or wrong shared secret", () => {
    const env = { UNDERWRITE_HOSTED_RUNTIME_SECRET: "platform-runtime" };
    expect(authorizeRuntime(new Headers(), env)).toBe(false);
    expect(authorizeRuntime(new Headers({ authorization: "Bearer nope" }), env)).toBe(false);
    expect(authorizeRuntime(new Headers({ authorization: "Bearer platform-runtime" }), env)).toBe(true);
    expect(authorizeRuntime(new Headers({ "x-underwrite-runtime-secret": "platform-runtime" }), env)).toBe(true);
  });
});
