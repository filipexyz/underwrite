import { describe, expect, it } from "vitest";
import { DEMO_INPUT_HTML, parseSource, renderDeliverable } from "@/lib/marketplace/artifact";
import { inspectArtifact, inspectPdfBytes } from "@/lib/verification/inspect";
import { HTML_TO_PDF_RUBRIC } from "@/lib/verification/rubric";
import { runChecks } from "@/lib/verification/checks";

const source = parseSource(DEMO_INPUT_HTML, "Compile input.html to a PDF: A4, 2cm margins");

describe("HTML → PDF bytes", () => {
  it("writes a real PDF and inspects C2 from bytes (not producer claims)", async () => {
    const artifact = await renderDeliverable(source, "c2-honest", {
      quality: "clean",
      latency_s: 8,
      latency_jitter: 0,
      self_report: 0.96,
      tokens: { in: 1, out: 1 },
    });
    const bytes = Buffer.from(artifact.pdf_base64, "base64");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const facts = await inspectPdfBytes(new Uint8Array(bytes), {
      artifact_ref: artifact.artifact_ref,
      observed_latency_ms: artifact.observed_latency_ms,
      declared_latency_ms: artifact.declared_latency_ms,
    });
    expect(facts.valid).toBe(true);
    expect(facts.pages).toBeGreaterThan(0);
    expect(facts.fonts_embedded).toBe(true);
    expect(facts.overflow_regions).toBe(0);
    expect(facts.links).toEqual(expect.arrayContaining(source.links));
    const checks = runChecks(HTML_TO_PDF_RUBRIC, facts, source);
    expect(checks.checks.every((c) => c.passed)).toBe(true);
  });

  it("C1 defects are in the file: overflow, missing fonts, clipped text", async () => {
    const artifact = await renderDeliverable(source, "c1-cheap", {
      quality: "layout_overflow",
      latency_s: 6,
      latency_jitter: 0,
      self_report: 0.98,
      tokens: { in: 1, out: 1 },
    });
    const facts = await inspectArtifact(artifact);
    expect(facts.valid).toBe(true);
    expect(facts.fonts_embedded).toBe(false);
    expect(facts.overflow_regions).toBeGreaterThanOrEqual(2);
    const checks = runChecks(HTML_TO_PDF_RUBRIC, facts, source);
    expect(checks.checks.filter((c) => !c.passed).map((c) => c.check_id)).toEqual(
      expect.arrayContaining(["no_layout_overflow", "text_matches_source", "fonts_embedded"]),
    );
  });
});
