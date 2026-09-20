import { describe, expect, it } from "vitest";
import { JobDeliverableInput } from "@/lib/contracts";

describe("JobDeliverableInput", () => {
  it("accepts an HTML specialty artifact without pdf_base64", () => {
    const parsed = JobDeliverableInput.parse({
      self_confidence: 0.72,
      artifact: {
        kind: "html",
        html: "<!doctype html><html><body><h1>Briefing</h1><p>Hold.</p></body></html>",
        observed_latency_ms: 1200,
        self_report: 0.72,
      },
    });
    expect(parsed.artifact.kind).toBe("html");
    expect(parsed.artifact.html).toContain("Briefing");
    expect(parsed.artifact.pdf_base64).toBeUndefined();
  });

  it("accepts markdown without a PDF", () => {
    const parsed = JobDeliverableInput.parse({
      artifact: { kind: "md", markdown: "# Findings\n\nHold the book.\n" },
    });
    expect(parsed.artifact.kind).toBe("md");
  });
});
