/**
 * Deterministic checks. Pass/fail, no opinion. The scoped rubric decides
 * which run and with what weight. Unknown check ids are still skipped.
 */
import type { Check, VerificationSpec } from "@/lib/contracts";
import type { SourceDocument } from "@/lib/marketplace/artifact";
import type { ArtifactFacts } from "./inspect";

export type CheckOutcome = { passed: boolean; detail: string };
export type CheckRunner = (facts: ArtifactFacts, source: SourceDocument) => CheckOutcome;

export const TEXT_COVERAGE_THRESHOLD = 0.98;
export const TOPIC_COVERAGE_THRESHOLD = 0.5;

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

function topicCoverage(topics: string[], artifactText: string): number {
  const need = topics.map((t) => t.toLowerCase()).filter(Boolean);
  if (need.length === 0) return 1;
  const hay = artifactText.toLowerCase();
  let hit = 0;
  for (const topic of need) {
    if (hay.includes(topic) || tokens(topic).every((t) => hay.includes(t))) hit += 1;
  }
  return hit / need.length;
}

function kindLabel(kind: ArtifactFacts["kind"]): string {
  if (kind === "html") return "HTML";
  if (kind === "md") return "Markdown";
  if (kind === "zip") return "ZIP";
  return "PDF";
}

function hasContent(facts: ArtifactFacts): boolean {
  return (
    facts.bytes > 0 ||
    facts.word_count > 0 ||
    facts.text.trim().length > 0 ||
    facts.screenshots_count > 0 ||
    facts.zip_entries.length > 0
  );
}

function renders(facts: ArtifactFacts): boolean {
  return facts.valid && hasContent(facts);
}

const STOPWORDS = new Set([
  "about",
  "after",
  "brief",
  "cover",
  "from",
  "that",
  "this",
  "with",
  "write",
  "report",
  "research",
  "please",
  "deliver",
  "include",
]);

function briefTopics(source: SourceDocument): string[] {
  if (source.expected_topics && source.expected_topics.length > 0) return source.expected_topics;
  const raw = source.requirement ?? source.text;
  return tokens(raw).filter((t) => t.length > 4 && !STOPWORDS.has(t)).slice(0, 12);
}

export const CHECK_RUNNERS: Record<string, { name: string; run: CheckRunner }> = {
  pdf_valid: {
    name: "Valid PDF",
    run: (f) => ({
      passed: f.kind === "pdf" && f.valid && f.bytes > 0,
      detail: f.kind === "pdf" && f.valid ? `parsed ${f.pages} page(s), ${f.bytes} bytes` : "artifact does not parse as PDF",
    }),
  },
  html_valid: {
    name: "Valid HTML",
    run: (f) => ({
      passed: f.kind === "html" && f.valid,
      detail: f.kind === "html" && f.valid ? `parsed HTML, ${f.bytes} bytes` : "artifact does not parse as HTML",
    }),
  },
  md_valid: {
    name: "Valid Markdown",
    run: (f) => ({
      passed: f.kind === "md" && f.valid,
      detail: f.kind === "md" && f.valid ? `parsed Markdown, ${f.word_count} words` : "artifact does not parse as Markdown",
    }),
  },
  artifact_exists: {
    name: "Artifact exists",
    run: (f) => ({
      passed: hasContent(f),
      detail: hasContent(f) ? `${kindLabel(f.kind)} artifact present (${f.bytes} bytes)` : "no artifact content",
    }),
  },
  artifact_renders: {
    name: "Artifact renders",
    run: (f) => ({
      passed: renders(f),
      detail: renders(f) ? `${kindLabel(f.kind)} parses (${f.bytes} bytes)` : `${kindLabel(f.kind)} does not render`,
    }),
  },
  artifact_not_empty: {
    name: "Artifact not empty",
    run: (f) => {
      if (f.kind === "zip") {
        const ok = f.zip_entries.length > 0;
        return { passed: ok, detail: ok ? `${f.zip_entries.length} zip entries` : "zip has no entries" };
      }
      return {
        passed: f.word_count > 0 || f.text.trim().length > 0,
        detail: f.word_count > 0 ? `${f.word_count} word(s)` : "artifact text is empty",
      };
    },
  },
  zip_valid: {
    name: "Valid ZIP",
    run: (f) => ({
      passed: f.kind === "zip" && f.valid && f.zip_entries.length > 0,
      detail:
        f.kind === "zip" && f.valid
          ? `parsed ZIP, ${f.zip_entries.length} entries, ${f.bytes} bytes`
          : "artifact does not parse as ZIP",
    }),
  },
  expected_entries_present: {
    name: "Expected zip entries",
    run: (f, s) => {
      const need = s.expected_entries ?? [];
      if (need.length === 0) {
        return {
          passed: f.zip_entries.length > 0,
          detail: f.zip_entries.length > 0 ? `${f.zip_entries.length} entries` : "zip has no entries",
        };
      }
      const have = f.zip_entries.map((n) => n.toLowerCase());
      const missing = need.filter((n) => !have.some((h) => h === n.toLowerCase() || h.endsWith(`/${n.toLowerCase()}`)));
      return {
        passed: missing.length === 0,
        detail: missing.length === 0 ? `entries: ${need.join(", ")}` : `missing entries: ${missing.join(", ")}`,
      };
    },
  },
  page_count: {
    name: "Page count",
    run: (f, s) => {
      /*
       * Two different things were being compared, and conflating them is what produced a false pass:
       *
       *   - the brief states a page count -> that is a *requirement* -> exact comparison
       *   - it does not -> `expected_pages` is a heuristic from the source length (chars / 3000) -> a
       *     measurement against an estimate, where +/-1 is honest tolerance
       *
       * A live run asked for a four-page translation, delivered one page, and passed — because a requirement
       * was compared to an estimate with a tolerance. It was never a tolerance problem; it was a
       * "which number is this" problem.
       */
      const delta = f.pages - s.expected_pages;
      const stated = s.pages_stated === true;
      const ok = stated ? delta === 0 : Math.abs(delta) <= 1;
      const gap = delta === 0 ? "as required" : delta > 0 ? `${delta} over` : `${Math.abs(delta)} short of`;
      return {
        passed: ok,
        detail: stated
          ? `${f.pages} page(s), ${gap} the ${s.expected_pages} the brief requires`
          : `${f.pages} page(s), ${gap} ~${s.expected_pages} estimated from source length`,
      };
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
  has_title: {
    name: "Has title",
    run: (f) => ({
      passed: Boolean(f.title?.trim()),
      detail: f.title?.trim() ? `title: ${f.title.trim()}` : "no document title or primary heading",
    }),
  },
  has_primary_cta: {
    name: "Has primary CTA",
    run: (f) => ({
      passed: f.cta_selectors_found.length > 0,
      detail: f.cta_selectors_found.length > 0 ? `cta: ${f.cta_selectors_found.join(", ")}` : "no primary CTA",
    }),
  },
  viewport_meta: {
    name: "Viewport meta",
    run: (f) => ({
      passed: f.has_viewport_meta,
      detail: f.has_viewport_meta ? "viewport meta present" : "missing viewport meta",
    }),
  },
  no_broken_required_assets: {
    name: "Required assets",
    run: (f) => ({
      passed: f.broken_required_assets.length === 0,
      detail:
        f.broken_required_assets.length === 0
          ? "required assets declare src/href"
          : `broken assets: ${f.broken_required_assets.join(", ")}`,
    }),
  },
  required_sections_present: {
    name: "Required sections",
    run: (f, s) => {
      const need = s.expected_sections ?? [];
      if (need.length === 0) {
        return { passed: f.sections.length > 0, detail: f.sections.length > 0 ? `${f.sections.length} section(s)` : "no sections found" };
      }
      const hay = `${f.sections.join(" ")} ${f.text}`.toLowerCase();
      const missing = need.filter((n) => !hay.includes(n.toLowerCase()));
      return {
        passed: missing.length === 0,
        detail: missing.length === 0 ? `sections: ${need.join(", ")}` : `missing sections: ${missing.join(", ")}`,
      };
    },
  },
  a11y_basics: {
    name: "Accessibility basics",
    run: (f) => {
      const ok = f.has_lang && f.images_missing_alt === 0;
      return {
        passed: ok,
        detail: ok ? "lang set, images have alt" : `lang=${f.has_lang}, images missing alt=${f.images_missing_alt}`,
      };
    },
  },
  screenshots_present: {
    name: "Screenshots present",
    run: (f) => ({
      passed: f.screenshots_count > 0,
      detail: f.screenshots_count > 0 ? `${f.screenshots_count} screenshot(s)` : "no screenshots attached",
    }),
  },
  has_primary_view: {
    name: "Primary view",
    run: (f) => ({
      passed: f.has_primary_view,
      detail: f.has_primary_view ? "primary view present" : "no main/dashboard/table view",
    }),
  },
  required_metrics_present: {
    name: "Required metrics",
    run: (f, s) => {
      const need = s.expected_metrics ?? [];
      if (need.length === 0) {
        return {
          passed: f.metrics_found.length > 0,
          detail: f.metrics_found.length > 0 ? `metrics: ${f.metrics_found.join(", ")}` : "no metrics found",
        };
      }
      const hay = f.metrics_found.join(" ").toLowerCase();
      const missing = need.filter((n) => !hay.includes(n.toLowerCase()) && !f.text.toLowerCase().includes(n.toLowerCase()));
      return {
        passed: missing.length === 0,
        detail: missing.length === 0 ? `metrics: ${need.join(", ")}` : `missing metrics: ${missing.join(", ")}`,
      };
    },
  },
  data_payload_nonempty: {
    name: "Data payload",
    run: (f) => ({
      passed: f.data_payload_nonempty,
      detail: f.data_payload_nonempty ? "data payload present" : "empty data payload",
    }),
  },
  filters_present: {
    name: "Filters present",
    run: (f) => ({
      passed: f.filters_found.length > 0,
      detail: f.filters_found.length > 0 ? `filters: ${f.filters_found.join(", ")}` : "no filters found",
    }),
  },
  has_structure: {
    name: "Report structure",
    run: (f) => ({
      passed: Boolean(f.title?.trim()) && f.sections.length >= 2,
      detail: f.sections.length >= 2 ? `${f.sections.length} headings` : "report lacks a heading structure",
    }),
  },
  covers_brief_topics: {
    name: "Covers brief topics",
    run: (f, s) => {
      const topics = briefTopics(s);
      const coverage = topicCoverage(topics, f.text);
      return {
        passed: coverage >= TOPIC_COVERAGE_THRESHOLD,
        detail: `${(coverage * 100).toFixed(0)}% of brief topics present`,
      };
    },
  },
  has_sources_section: {
    name: "Sources section",
    run: (f) => ({
      passed: f.has_sources_section,
      detail: f.has_sources_section ? "sources / citations present" : "no sources section",
    }),
  },
  min_length: {
    name: "Minimum length",
    run: (f, s) => {
      const floor = s.min_word_count ?? 0;
      const ok = floor <= 0 ? f.word_count > 0 : f.word_count >= floor;
      return { passed: ok, detail: `${f.word_count} words${floor > 0 ? ` (floor ${floor})` : ""}` };
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
