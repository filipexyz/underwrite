import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseSource, type DeliveryArtifact } from "@/lib/marketplace/artifact";
import { impliedZipEntries, isZipBytes } from "@/lib/marketplace/zip";
import { runChecks } from "@/lib/verification/checks";
import { inspectArtifact } from "@/lib/verification/inspect";
import { SPECIALTY_REPORT_RUBRIC, scopeChecks } from "@/lib/verification/rubric";

function zipBase64(files: Record<string, string>): string {
  const record: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) record[name] = strToU8(content);
  return Buffer.from(zipSync(record)).toString("base64");
}

describe("zip deliverable", () => {
  it("inspects a ZIP, runs zip checks, and never applies pdf_valid", async () => {
    const requirement = "Produce report.md and data.json as a zip for this analista de investimentos briefing.";
    expect(impliedZipEntries(requirement)).toEqual(["report.md", "data.json"]);

    const artifact: DeliveryArtifact = {
      artifact_ref: "art_zip",
      kind: "zip",
      producer_agent_id: "c2-honest",
      zip_base64: zipBase64({
        "report.md": "# Findings\n\nAllocation and risk for this analista de investimentos book.\n\n## Risks\n\nFX.\n\n## Recommendation\n\nHold.\n",
        "data.json": '{"hold":true}',
      }),
      self_report: 0.7,
      observed_latency_ms: 12,
      declared_latency_ms: 12,
    };

    const facts = await inspectArtifact(artifact);
    expect(facts.kind).toBe("zip");
    expect(facts.valid).toBe(true);
    expect(facts.zip_entries).toEqual(expect.arrayContaining(["report.md", "data.json"]));
    expect(isZipBytes(Buffer.from(artifact.zip_base64 ?? "", "base64"))).toBe(true);

    const spec = scopeChecks(SPECIALTY_REPORT_RUBRIC, requirement, {
      category: "analista de investimentos",
      artifact_kind: "zip",
    });
    expect(spec.checks.map((c) => c.check_id)).toEqual(expect.arrayContaining(["zip_valid", "expected_entries_present"]));
    expect(spec.checks.map((c) => c.check_id)).not.toEqual(
      expect.arrayContaining(["pdf_valid", "text_matches_source", "fonts_embedded"]),
    );

    const result = runChecks(spec, facts, parseSource("", requirement));
    expect(result.checks.find((c) => c.check_id === "zip_valid")?.passed).toBe(true);
    expect(result.checks.find((c) => c.check_id === "expected_entries_present")?.passed).toBe(true);
    expect(result.checks.find((c) => c.check_id === "pdf_valid")).toBeUndefined();
  });

  it("fails zip_valid on garbage bytes and does not evaluate pdf_valid", async () => {
    const requirement = "Ship report.md and data.json as a zip.";
    const artifact: DeliveryArtifact = {
      artifact_ref: "art_bad_zip",
      kind: "zip",
      producer_agent_id: "c2-honest",
      zip_base64: Buffer.from("not-a-zip").toString("base64"),
      self_report: 0.4,
      observed_latency_ms: 4,
      declared_latency_ms: 4,
    };
    const facts = await inspectArtifact(artifact);
    expect(facts.kind).toBe("zip");
    expect(facts.valid).toBe(false);

    const spec = scopeChecks(SPECIALTY_REPORT_RUBRIC, requirement, {
      category: "analista de investimentos",
      artifact_kind: "zip",
    });
    const result = runChecks(spec, facts, parseSource("", requirement));
    expect(result.checks.find((c) => c.check_id === "zip_valid")?.passed).toBe(false);
    expect(result.checks.find((c) => c.check_id === "pdf_valid")).toBeUndefined();
  });

  it("fails expected_entries_present when a named file is missing", async () => {
    const requirement = "Produce report.md and data.json as a zip.";
    const artifact: DeliveryArtifact = {
      artifact_ref: "art_partial_zip",
      kind: "zip",
      producer_agent_id: "c2-honest",
      zip_base64: zipBase64({ "report.md": "# Only the prose\n" }),
      self_report: 0.5,
      observed_latency_ms: 6,
      declared_latency_ms: 6,
    };
    const facts = await inspectArtifact(artifact);
    const spec = scopeChecks(SPECIALTY_REPORT_RUBRIC, requirement, {
      category: "analista de investimentos",
      artifact_kind: "zip",
    });
    const result = runChecks(spec, facts, parseSource("", requirement));
    expect(result.checks.find((c) => c.check_id === "zip_valid")?.passed).toBe(true);
    expect(result.checks.find((c) => c.check_id === "expected_entries_present")?.passed).toBe(false);
    expect(result.checks.find((c) => c.check_id === "expected_entries_present")?.detail).toMatch(/data\.json/);
  });
});
