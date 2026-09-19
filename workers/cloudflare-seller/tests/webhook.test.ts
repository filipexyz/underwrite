import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnderwriteEvent } from "../src/protocol";
import { signWebhookBody, verifyWebhookSignature } from "../src/webhook";
import { clampPlanToConstraints, parsePlanDraft } from "../src/plan";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

describe("webhook HMAC (timestamp.body)", () => {
  it("verifies the same construction as Underwrite webhooks.ts", async () => {
    const body = JSON.stringify({ type: "plan_request", job_id: "req_1" });
    const timestamp = "1710000000000";
    const secret = "underwrite-webhook-stub";
    const signature = await signWebhookBody(body, timestamp, secret);
    expect(
      await verifyWebhookSignature({
        body,
        timestamp,
        signature: `sha256=${signature}`,
        secret,
      }),
    ).toBe(true);
    expect(
      await verifyWebhookSignature({
        body,
        timestamp,
        signature,
        secret: "other",
      }),
    ).toBe(false);
  });
});

describe("parseUnderwriteEvent", () => {
  it("parses the plan_request fixture from push.ts briefPayload", () => {
    const event = parseUnderwriteEvent(loadFixture("plan_request.json"));
    expect(event?.type).toBe("plan_request");
    if (event?.type !== "plan_request") throw new Error("expected plan_request");
    expect(event.job_id).toBe("req_smokeplanrequest01");
    expect(event.brief.files[0]?.content).toBe("<h1>Hello</h1>");
    expect(event.constraints.min_confidence).toBe(0.95);
  });

  it("parses accepted with execute: true", () => {
    const event = parseUnderwriteEvent(loadFixture("accepted.json"));
    expect(event?.type).toBe("accepted");
    if (event?.type !== "accepted") throw new Error("expected accepted");
    expect(event.execute).toBe(true);
    expect(event.plan_id).toMatch(/^plan_/);
  });

  it("unwraps an inbox row", () => {
    const event = parseUnderwriteEvent({
      inbox_id: "inbox_1",
      job_id: "req_inbox",
      type: "rejected",
      payload: {
        type: "rejected",
        job_id: "req_inbox",
        request_id: "req_inbox",
        plan_id: null,
        reason: "plan window closed without a submission",
      },
    });
    expect(event).toEqual({
      type: "rejected",
      job_id: "req_inbox",
      request_id: "req_inbox",
      plan_id: null,
      reason: "plan window closed without a submission",
    });
  });
});

describe("JobPlanInput clamp", () => {
  it("keeps a compliant draft inside buyer ceilings", () => {
    const plan = clampPlanToConstraints(
      {
        approach: "careful render",
        price_usd: 0.04,
        promised_confidence: 0.96,
        max_latency_s: 8,
      },
      { max_cost_usd: 0.05, max_latency_s: 30, min_confidence: 0.95 },
    );
    expect(plan.price_usd).toBe(0.04);
    expect(plan.promised_confidence).toBe(0.96);
    expect(plan.max_latency_s).toBe(8);
  });

  it("raises confidence and caps price/latency", () => {
    const plan = clampPlanToConstraints(
      {
        price_usd: 0.2,
        promised_confidence: 0.5,
        max_latency_s: 90,
      },
      { max_cost_usd: 0.05, max_latency_s: 30, min_confidence: 0.95 },
    );
    expect(plan.price_usd).toBe(0.05);
    expect(plan.promised_confidence).toBe(0.95);
    expect(plan.max_latency_s).toBe(30);
  });

  it("rejects incomplete model JSON", () => {
    expect(parsePlanDraft({ approach: "x" })).toBeNull();
    expect(parsePlanDraft({ price_usd: 0.01, promised_confidence: 0.96, max_latency_s: 8 })).toMatchObject({
      price_usd: 0.01,
    });
  });
});
