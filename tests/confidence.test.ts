import { describe, expect, it } from "vitest";
import { computeConfidence, processSignal } from "@/lib/verification/confidence";
import { runChecks, textCoverage } from "@/lib/verification/checks";
import { inspectArtifact } from "@/lib/verification/inspect";
import { HTML_TO_PDF_RUBRIC } from "@/lib/verification/rubric";
import { DEMO_INPUT_HTML, parseSource, renderDeliverable } from "@/lib/marketplace/artifact";

const source = parseSource(DEMO_INPUT_HTML, "A4, 2cm margins");

describe("confidence (hardcoded_v0)", () => {
  it("scores the liar's overflow around 41% from real PDF bytes", async () => {
    const artifact = await renderDeliverable(source, "c1-cheap", {
      quality: "layout_overflow",
      latency_s: 6,
      latency_jitter: 0.089,
      self_report: 0.98,
      tokens: { in: 1, out: 1 },
    });
    const facts = await inspectArtifact(artifact);
    const checks = runChecks(HTML_TO_PDF_RUBRIC, facts, source);
    expect(checks.conclusive).toBe(true);
    expect(checks.checks.filter((c) => !c.passed).map((c) => c.check_id)).toEqual(["text_matches_source", "no_layout_overflow", "fonts_embedded"]);

    const breakdown = computeConfidence({
      objective: checks.objective,
      agreement: null,
      track_record: 0.66,
      process: processSignal(artifact.observed_latency_ms, artifact.declared_latency_ms),
      self_report: artifact.self_report,
    });
    expect(breakdown.method).toBe("hardcoded_v0");
    expect(breakdown.computed).toBeGreaterThan(0.38);
    expect(breakdown.computed).toBeLessThan(0.44);
    expect(breakdown.computed).toBeLessThan(breakdown.self_report as number);
  });

  it("scores the honest renderer with agreeing judges around 96%", async () => {
    const artifact = await renderDeliverable(source, "c2-honest", {
      quality: "clean",
      latency_s: 8,
      latency_jitter: 0,
      self_report: 0.96,
      tokens: { in: 1, out: 1 },
    });
    const facts = await inspectArtifact(artifact);
    const checks = runChecks(HTML_TO_PDF_RUBRIC, facts, source);
    expect(checks.objective).toBe(1);
    const breakdown = computeConfidence({ objective: 1, agreement: 1, track_record: 0.8, process: 1, self_report: 0.96 });
    expect(breakdown.computed).toBeGreaterThanOrEqual(0.95);
    expect(breakdown.computed).toBeLessThan(0.97);
  });

  it("never lets the self-report carry more than its capped weight", () => {
    const honest = computeConfidence({ objective: 0.5, agreement: null, track_record: 0.5, process: 1, self_report: 0.5 });
    const inflated = computeConfidence({ objective: 0.5, agreement: null, track_record: 0.5, process: 1, self_report: 1.0 });
    // A +0.5 self-report moves the score by at most w_self·0.5 and is then penalised for diverging.
    expect(inflated.computed - honest.computed).toBeLessThan(0.05);
    expect(inflated.computed).toBeLessThan(honest.computed + 0.1 * 0.5);
  });

  it("falls back to the remaining signals when some are missing", () => {
    const only = computeConfidence({ objective: null, agreement: null, track_record: 0.7, process: null, self_report: null });
    expect(only.computed).toBe(0.7);
    const nothing = computeConfidence({ objective: null, agreement: null, track_record: null, process: null, self_report: null });
    expect(nothing.computed).toBe(0);
  });

  it("measures text coverage as a multiset of tokens", () => {
    expect(textCoverage("the quick brown fox", "the quick brown fox")).toBe(1);
    expect(textCoverage("the quick brown fox", "the quick")).toBe(0.5);
    expect(textCoverage("", "anything")).toBe(1);
  });
});
