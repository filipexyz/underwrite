import { describe, expect, it } from "vitest";
import { eventNeedsCredentials, missingCredentials } from "../src/provisioning";
import type { SellerConfig } from "../src/config";
import type { AcceptedEvent, PlanRequestEvent, RejectedEvent } from "../src/protocol";

const baseConfig: SellerConfig = {
  underwriteBaseUrl: "https://underwrite-gamma.vercel.app",
  sellerApiKey: "uw_seller_x",
  webhookSecret: "whsec_x",
  neuralakeBaseUrl: "https://api.neuralake.cloud/v1",
  neuralakeApiKey: "nl_x",
  neuralakeModel: "auto",
  instanceName: "agt_a",
};

const constraints = { max_cost_usd: 0.05, max_latency_s: 30, min_confidence: 0.95 };

const planRequest: PlanRequestEvent = {
  type: "plan_request",
  job_id: "req_1",
  request_id: "req_1",
  brief: { requirement: "compile to pdf", files: [] },
  constraints,
  plan_deadline_at: "2026-09-20T03:00:00.000Z",
};

const accepted = (execute: boolean): AcceptedEvent => ({
  type: "accepted",
  job_id: "req_1",
  request_id: "req_1",
  plan_id: "plan_1",
  execute,
  price_usd: 0.016,
  promised_confidence: 0.96,
});

const rejected: RejectedEvent = {
  type: "rejected",
  job_id: "req_1",
  request_id: "req_1",
  plan_id: null,
  reason: "not selected (best-score)",
};

describe("eventNeedsCredentials", () => {
  it("requires credentials for work that calls Underwrite or NeuraLake", () => {
    expect(eventNeedsCredentials(planRequest)).toBe(true);
    expect(eventNeedsCredentials(accepted(true))).toBe(true);
  });

  it("does not require credentials for events that only touch local state", () => {
    // `accepted` with execute=false is an acknowledgement, not a job.
    expect(eventNeedsCredentials(accepted(false))).toBe(false);
    // A rejection needs neither a seller key nor BYOK.
    expect(eventNeedsCredentials(rejected)).toBe(false);
  });
});

describe("missingCredentials", () => {
  it("reports nothing when the Durable Object is fully provisioned", () => {
    expect(missingCredentials(baseConfig)).toEqual([]);
  });

  it("names the missing credentials, and never their values", () => {
    expect(missingCredentials({ ...baseConfig, sellerApiKey: "" })).toEqual(["seller_api_key"]);
    expect(missingCredentials({ ...baseConfig, neuralakeApiKey: "" })).toEqual(["byok_api_key"]);
    expect(missingCredentials({ ...baseConfig, sellerApiKey: "", neuralakeApiKey: "" })).toEqual([
      "seller_api_key",
      "byok_api_key",
    ]);
  });
});
