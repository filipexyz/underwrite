/**
 * Deterministic checks for HTML → PDF (PRODUCT.md "five signals", #1).
 * Pass/fail, no opinion. The rubric decides which run and with what weight.
 */
import type { Check, VerificationSpec } from "@/lib/contracts";
import type { SourceDocument } from "@/lib/marketplace/artifact";
import type { ArtifactFacts } from "./inspect";

export type CheckOutcome = { passed: boolean; detail: string };
export type CheckRunner = (facts: ArtifactFacts, source: SourceDocument) => CheckOutcome;

export const TEXT_COVERAGE_THRESHOLD = 0.98;

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Share of source tokens recovered from the artifact text (multiset coverage). */
export function textCoverage(sourceText: string, artifactText: string): number {
  const need = tokens(sourceText);
  if (need.length === 0) return 1;
  const have = new Map<string, number>();
  for (const t of tokens(artifactText)) have.set(t, (have.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of need) {
    const n = have.get(t) ?? 0;
    if (n > 0) {
      hit += 1;
      have.set(t, n - 1);
    }
  }
  return hit / need.length;
}

export const CHECK_RUNNERS: Record<string, { name: string; run: CheckRunner }> = {
  pdf_valid: {
    name: "Valid PDF",
    run: (f) => ({
      passed: f.valid && f.bytes > 0,
      detail: f.valid ? `parsed ${f.pages} page(s), ${f.bytes} bytes` : "artifact does not parse as PDF",
    }),
  },
  page_count: {
    name: "Page count",
    run: (f, s) => {
      const ok = Math.abs(f.pages - s.expected_pages) <= 1;
      return { passed: ok, detail: `${f.pages} page(s), expected ~${s.expected_pages} at A4 / ${s.margins_cm}cm margins` };
    },
  },
  text_matches_source: {
    name: "Extracted text matches source",
    run: (f, s) => {
      const coverage = textCoverage(s.text, f.text);
      return {
        passed: coverage >= TEXT_COVERAGE_THRESHOLD,
        detail: `${(coverage * 100).toFixed(1)}% of source text recovered (threshold ${TEXT_COVERAGE_THRESHOLD * 100}%)`,
      };
    },
  },
  no_layout_overflow: {
    name: "No layout overflow",
    run: (f) => ({
      passed: f.overflow_regions === 0,
      detail: f.overflow_regions === 0 ? "no region exceeds its page box" : `${f.overflow_regions} region(s) overflow the page box`,
    }),
  },
  fonts_embedded: {
    name: "Fonts embedded",
    run: (f) => ({ passed: f.fonts_embedded, detail: f.fonts_embedded ? "all fonts embedded" : "fonts referenced, not embedded" }),
  },
  links_preserved: {
    name: "Links preserved",
    run: (f, s) => {
      const missing = s.links.filter((l) => !f.links.includes(l));
      return {
        passed: missing.length === 0,
        detail: missing.length === 0 ? `${s.links.length} link(s) preserved` : `missing ${missing.length}/${s.links.length}: ${missing.join(", ")}`,
      };
    },
  },
};

export type ChecksResult = {
  checks: Check[];
  /** Weighted pass ratio over the checks that could be evaluated; `null` if none could. */
  objective: number | null;
  /** True when at least one declared check has a runner. */
  conclusive: boolean;
  unknown_check_ids: string[];
};

export function runChecks(spec: VerificationSpec, facts: ArtifactFacts, source: SourceDocument): ChecksResult {
  const checks: Check[] = [];
  const unknown: string[] = [];
  let passedWeight = 0;
  let totalWeight = 0;

  for (const declared of spec.checks) {
    const runner = CHECK_RUNNERS[declared.check_id];
    if (!runner) {
      unknown.push(declared.check_id);
      continue;
    }
    const outcome = runner.run(facts, source);
    checks.push({
      check_id: declared.check_id,
      name: runner.name,
      passed: outcome.passed,
      detail: outcome.detail,
      weight: declared.weight,
    });
    totalWeight += declared.weight;
    if (outcome.passed) passedWeight += declared.weight;
  }

  return {
    checks,
    objective: totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 10_000) / 10_000 : null,
    conclusive: totalWeight > 0,
    unknown_check_ids: unknown,
  };
}
