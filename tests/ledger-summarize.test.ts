import { describe, expect, it } from "vitest";
import { summarizeEvent } from "@/lib/ledger/summarize";

describe("summarizeEvent plan_generated", () => {
  it("uses engine field names when present", () => {
    const summary = summarizeEvent({
      type: "plan_generated",
      payload: {
        promised_confidence: 0.96,
        max_cost_usd: 0.04,
        est_latency_s: 8,
        strategy_chosen: "self",
        chain: [{ agent_id: "agt_1" }],
      },
    });
    expect(summary).toContain("96%");
    expect(summary).toContain("$0.0400");
    expect(summary).toContain("8s");
    expect(summary).toContain("self");
    expect(summary).not.toMatch(/NaN|undefined/);
  });

  it("falls back to push-job price_usd / max_latency_s so the ledger is not max $NaN · undefineds", () => {
    const summary = summarizeEvent({
      type: "plan_generated",
      payload: {
        promised_confidence: 0.96,
        price_usd: 0.04,
        max_latency_s: 8,
        chain: [{ agent_id: "agt_1" }],
      },
    });
    expect(summary).toContain("$0.0400");
    expect(summary).toContain("8s");
    expect(summary).toContain("self");
    expect(summary).not.toMatch(/NaN|undefined/);
  });
});
