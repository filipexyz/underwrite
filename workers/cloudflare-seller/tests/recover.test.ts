import { describe, expect, it } from "vitest";
import { eventFromRecovery, mergeJob } from "../src/recover";
import { parseUnderwriteEvent } from "../src/protocol";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const planRequest = JSON.parse(readFileSync(join(fixtures, "plan_request.json"), "utf8"));

describe("mergeJob", () => {
  it("keeps Durable Object credentials and tenants when recording a job", () => {
    const next = mergeJob(
      {
        jobs: {} as Record<string, { lastType?: string }>,
        credentials: { sellerApiKey: "uw_seller_x", webhookSecret: "whsec_x", neuralakeApiKey: "nl_x" },
        tenants: ["agt_a"],
        lastError: "old",
      },
      "req_1",
      { lastType: "plan_request" },
    );
    expect(next.credentials?.sellerApiKey).toBe("uw_seller_x");
    expect(next.credentials?.neuralakeApiKey).toBe("nl_x");
    expect(next.tenants).toEqual(["agt_a"]);
    expect(next.lastError).toBe("old");
    expect(next.jobs.req_1?.lastType).toBe("plan_request");
  });
});

describe("eventFromRecovery", () => {
  it("prefers the fiber snapshot, then metadata, then stored job memory", () => {
    const event = parseUnderwriteEvent(planRequest);
    expect(event?.type).toBe("plan_request");
    expect(eventFromRecovery({ event }, null, null)?.job_id).toBe(event?.job_id);
    expect(eventFromRecovery({ event: null }, { event }, null)?.job_id).toBe(event?.job_id);
    expect(eventFromRecovery(null, { type: "plan_request", job_id: event?.job_id }, event)?.job_id).toBe(
      event?.job_id,
    );
    expect(eventFromRecovery(null, { type: "plan_request", job_id: "req_x" }, null)).toBeNull();
  });
});
