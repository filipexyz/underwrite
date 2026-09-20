/**
 * The verification rubric ships with the task (D-031): machine-readable,
 * versioned, declared in the request. A buyer that sends none gets the
 * category default below, and the ledger records which version judged it.
 *
 * Scoping = intersection(category check map, checks implied by TASK_SPEC).
 * Out-of-scope criteria are invisible — they never run and never fail.
 */
import type { DeclaredCheck, VerificationSpec } from "@/lib/contracts";
import type { ArtifactKind } from "@/lib/marketplace/artifact";

export const TASK_CATEGORIES = ["html_to_pdf", "landing_page", "dashboard", "research_report"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const SHARED_CHECK_IDS = ["artifact_exists", "artifact_renders", "artifact_not_empty"] as const;

export const PDF_GEOMETRY_CHECK_IDS = [
  "page_count",
  "no_layout_overflow",
  "fonts_embedded",
  "links_preserved",
  "text_matches_source",
  "pdf_valid",
] as const;

export const LANDING_CHECK_IDS = [
  "has_title",
  "has_primary_cta",
  "viewport_meta",
  "no_broken_required_assets",
  "required_sections_present",
  "a11y_basics",
  "screenshots_present",
] as const;

export const DASHBOARD_CHECK_IDS = [
  "has_primary_view",
  "required_metrics_present",
  "data_payload_nonempty",
  "filters_present",
] as const;

export const RESEARCH_CHECK_IDS = ["has_structure", "covers_brief_topics", "has_sources_section", "min_length"] as const;

export const ZIP_CHECK_IDS = ["zip_valid", "expected_entries_present"] as const;

export const HTML_TO_PDF_RUBRIC: VerificationSpec = {
  rubric_version: "html_to_pdf@v0",
  /** Weighted share of checks that must pass. 1 = every check. */
  required_passing: 1,
  checks: [
    { check_id: "pdf_valid", weight: 1, description: "The artifact parses as a PDF document." },
    { check_id: "page_count", weight: 1, description: "Page count matches the source length at A4 with the requested margins." },
    { check_id: "text_matches_source", weight: 2, description: "Text extracted from the PDF covers the source text (≥ 98%)." },
    { check_id: "no_layout_overflow", weight: 2, description: "No content region overflows its page box." },
    { check_id: "fonts_embedded", weight: 1, description: "Every font used is embedded in the file." },
    { check_id: "links_preserved", weight: 1, description: "Every hyperlink in the source is present in the PDF." },
  ],
};

const sharedChecks: DeclaredCheck[] = [
  { check_id: "artifact_exists", weight: 1, description: "A deliverable artifact is present." },
  { check_id: "artifact_renders", weight: 1, description: "The artifact parses as the expected kind (HTML, PDF, Markdown, or ZIP)." },
  { check_id: "artifact_not_empty", weight: 1, description: "The artifact contains extractable content." },
];

/** Content rubric for custom specialties (HTML, Markdown, or ZIP — not a PDF compile). */
export const SPECIALTY_REPORT_RUBRIC: VerificationSpec = {
  rubric_version: "specialty_report@v0",
  required_passing: 1,
  checks: [
    ...sharedChecks,
    { check_id: "has_structure", weight: 2, description: "The report has a titled heading structure." },
    { check_id: "covers_brief_topics", weight: 2, description: "The report covers the topics named in the brief." },
  ],
};

export const LANDING_PAGE_RUBRIC: VerificationSpec = {
  rubric_version: "landing_page@v0",
  required_passing: 1,
  checks: [
    ...sharedChecks,
    { check_id: "has_title", weight: 1, description: "The page has a document title or primary heading." },
    { check_id: "has_primary_cta", weight: 2, description: "A primary call-to-action is present." },
    { check_id: "viewport_meta", weight: 1, description: "A viewport meta tag is present for responsive layout." },
    { check_id: "no_broken_required_assets", weight: 1, description: "Required img/link/script assets declare a non-empty src or href." },
    { check_id: "required_sections_present", weight: 2, description: "Sections named in the brief appear in the page." },
    { check_id: "a11y_basics", weight: 1, description: "Deterministic a11y basics: html lang and images have alt text." },
    { check_id: "screenshots_present", weight: 1, description: "Responsive screenshots are attached when the task or artifact includes them." },
  ],
};

export const DASHBOARD_RUBRIC: VerificationSpec = {
  rubric_version: "dashboard@v0",
  required_passing: 1,
  checks: [
    ...sharedChecks,
    { check_id: "has_primary_view", weight: 2, description: "A primary dashboard view (main, table, chart, or panel) is present." },
    { check_id: "required_metrics_present", weight: 2, description: "Metrics named in the brief (or any KPI/stat) are displayed." },
    { check_id: "data_payload_nonempty", weight: 2, description: "The dashboard carries a non-empty data payload or table rows." },
    { check_id: "filters_present", weight: 1, description: "Filters, search, or query controls are present." },
  ],
};

export const RESEARCH_REPORT_RUBRIC: VerificationSpec = {
  rubric_version: "research_report@v0",
  required_passing: 1,
  checks: [
    ...sharedChecks,
    { check_id: "has_structure", weight: 2, description: "The report has a titled heading structure." },
    { check_id: "covers_brief_topics", weight: 2, description: "The report covers the topics named in the brief." },
    { check_id: "has_sources_section", weight: 2, description: "A sources / citations / references section is present." },
    { check_id: "min_length", weight: 1, description: "The report meets the word-count floor declared in the brief." },
  ],
};

const RUBRICS: Record<string, VerificationSpec> = {
  html_to_pdf: HTML_TO_PDF_RUBRIC,
  landing_page: LANDING_PAGE_RUBRIC,
  dashboard: DASHBOARD_RUBRIC,
  research_report: RESEARCH_REPORT_RUBRIC,
};

export function isKnownCategory(category: string | undefined): category is TaskCategory {
  return Boolean(category && (TASK_CATEGORIES as readonly string[]).includes(category));
}

export function defaultRubricFor(category: string): VerificationSpec {
  return RUBRICS[category] ?? SPECIALTY_REPORT_RUBRIC;
}

export type ScopeConstraints = {
  category?: string;
  artifact_kind?: ArtifactKind;
  screenshots_count?: number;
  min_length?: number;
  /** Landing page only: PDF geometry may apply when the brief requested a PDF. */
  optional_pdf?: boolean;
};

/**
 * Implication heuristics (TASK_SPEC + constraints → check ids).
 *
 * Shared (every known category; still dropped when the artifact kind cannot
 * support them, e.g. `pdf_valid` on HTML):
 *   artifact_exists / artifact_renders / artifact_not_empty — always implied
 *   pdf_valid   — PDF kind, the word "pdf", or category html_to_pdf
 *   html_valid  — HTML kind, or landing_page / dashboard
 *   md_valid    — Markdown kind, the word "markdown", or research_report
 *
 * html_to_pdf (and landing_page only when an optional PDF was requested):
 *   page_count          — A4, letter, page(s), margin(s), geometry, page size
 *   no_layout_overflow  — overflow, layout, clip, margin
 *   fonts_embedded      — font(s), embedded
 *   links_preserved     — link(s), hyperlink, href
 *   text_matches_source — text, preserve, extract, source, compile, convert
 *
 * landing_page (never inherited by research_report):
 *   has_title                 — title, heading, h1, landing, website, site, page
 *   has_primary_cta           — CTA, call to action, button, sign up, get started
 *   viewport_meta             — viewport, mobile, responsive, device
 *   no_broken_required_assets — asset, image, css, script, stylesheet, broken
 *   required_sections_present — section, hero, features, pricing, about, faq
 *   a11y_basics               — a11y, accessibility, alt, aria, contrast
 *   screenshots_present       — screenshot(s), or artifact already has screenshots
 *
 * dashboard:
 *   has_primary_view         — dashboard, view, chart, table, panel
 *   required_metrics_present — metric, kpi, stat
 *   data_payload_nonempty    — data, json, payload, dataset
 *   filters_present          — filter, dropdown, query
 *
 * research_report:
 *   has_structure        — structure, section, heading, outline, report
 *   covers_brief_topics  — topic, cover, coverage, brief
 *   has_sources_section  — citation(s), source(s), bibliography, references
 *   min_length           — "at least N words" / constraints.min_length
 *
 * Hard cross-rules:
 *   PDF geometry words (A4, margins, fonts) do NOT imply anything for
 *   landing_page unless the brief requested an optional PDF.
 *   research_report never implies CTA / landing-only checks.
 */
export function impliedCheckIds(taskRequirement: string, constraints: ScopeConstraints = {}): Set<string> {
  const text = taskRequirement.toLowerCase();
  const category = constraints.category;
  const optionalPdf = constraints.optional_pdf ?? (category === "landing_page" && /\bpdf\b/.test(text));
  const implied = new Set<string>(SHARED_CHECK_IDS);
  const kind = constraints.artifact_kind;

  if (kind === "pdf" || category === "html_to_pdf" || /\bpdf\b/.test(text)) implied.add("pdf_valid");
  if (kind === "html" || category === "landing_page" || category === "dashboard") implied.add("html_valid");
  if (kind === "md" || category === "research_report" || /\bmarkdown\b|\.md\b/.test(text)) implied.add("md_valid");
  if (kind === "zip" || /\bzip\b|\.zip\b/.test(text) || (taskRequirement.match(/\b[\w.-]+\.(?:md|html?|json|csv|txt|png|svg)\b/gi) ?? []).length >= 2) {
    implied.add("zip_valid");
    implied.add("expected_entries_present");
  }

  const allowPdfGeometry =
    category === "html_to_pdf" ||
    category === undefined ||
    (category === "landing_page" && optionalPdf) ||
    (category === "research_report" && (kind === "pdf" || /\bpdf\b/.test(text)));

  if (allowPdfGeometry) {
    if (/\b(a4|letter|pages?|margins?|geometry|page\s*size)\b/.test(text)) implied.add("page_count");
    if (/\b(overflow|layout|clip|margins?)\b/.test(text)) implied.add("no_layout_overflow");
    if (/\bfonts?\b/.test(text) || /\bembedded\b/.test(text)) implied.add("fonts_embedded");
    if (/\b(links?|hyperlink|href)\b/.test(text)) implied.add("links_preserved");
    if (/\b(text|preserve|extract|source|compile|convert)\b/.test(text)) implied.add("text_matches_source");
  }

  if (category !== "research_report" && category !== "html_to_pdf") {
    if (/\b(title|heading|\bh1\b|landing|website|site|page)\b/.test(text)) implied.add("has_title");
    if (/\b(cta|call to action|buttons?|sign[\s-]?up|get started|subscribe)\b/.test(text)) implied.add("has_primary_cta");
    if (/\b(viewport|mobile|responsive|device)\b/.test(text)) implied.add("viewport_meta");
    if (/\b(assets?|images?|css|scripts?|stylesheet|broken)\b/.test(text)) implied.add("no_broken_required_assets");
    if (/\b(sections?|hero|features|pricing|about|faq|testimonials?)\b/.test(text)) implied.add("required_sections_present");
    if (/\b(a11y|accessibility|alt(?:\s+text)?|aria|contrast)\b/.test(text)) implied.add("a11y_basics");
    if (/\bscreenshots?\b/.test(text) || (constraints.screenshots_count ?? 0) > 0) implied.add("screenshots_present");
  }

  if (category === "dashboard" || category === undefined) {
    if (/\b(dashboard|view|chart|table|panel)\b/.test(text)) implied.add("has_primary_view");
    if (/\b(metrics?|kpis?|stats?)\b/.test(text)) implied.add("required_metrics_present");
    if (/\b(data|json|payload|dataset)\b/.test(text)) implied.add("data_payload_nonempty");
    if (/\b(filters?|dropdown|query)\b/.test(text)) implied.add("filters_present");
  }

  if (category === "research_report" || category === undefined) {
    if (/\b(structure|sections?|headings?|outline|report)\b/.test(text)) implied.add("has_structure");
    if (/\b(topics?|cover(?:age|s|ing)?|brief)\b/.test(text)) implied.add("covers_brief_topics");
    if (/\b(citations?|sources?|bibliography|references?)\b/.test(text)) implied.add("has_sources_section");
    if (constraints.min_length || /(?:at least|min(?:imum)?(?:\s+length)?|≥|>=)\s*\d+\s*words/.test(text)) {
      implied.add("min_length");
    }
  }

  return implied;
}

function categoryFromRubric(version: string): string | undefined {
  const known = TASK_CATEGORIES.find((c) => version.startsWith(`${c}@`));
  return known;
}

function asSpec(specOrMap: VerificationSpec | string): VerificationSpec {
  return typeof specOrMap === "string" ? defaultRubricFor(specOrMap) : specOrMap;
}

function kindSupports(checkId: string, kind: ArtifactKind | undefined): boolean {
  if (!kind) return true;
  if (checkId === "pdf_valid" || PDF_GEOMETRY_CHECK_IDS.includes(checkId as (typeof PDF_GEOMETRY_CHECK_IDS)[number])) {
    return kind === "pdf";
  }
  if (ZIP_CHECK_IDS.includes(checkId as (typeof ZIP_CHECK_IDS)[number])) return kind === "zip";
  if (checkId === "html_valid") return kind === "html";
  if (checkId === "md_valid") return kind === "md";
  if (LANDING_CHECK_IDS.includes(checkId as (typeof LANDING_CHECK_IDS)[number])) {
    return kind === "html" || kind === "zip" || checkId === "screenshots_present";
  }
  if (DASHBOARD_CHECK_IDS.includes(checkId as (typeof DASHBOARD_CHECK_IDS)[number])) return kind === "html" || kind === "zip";
  return true;
}

function askedForPdf(taskRequirement: string, category: string | undefined): boolean {
  return category === "html_to_pdf" || /\bpdf\b/i.test(taskRequirement);
}

function dropPdfOnlyChecks(
  spec: VerificationSpec,
  taskRequirement: string,
  constraints: ScopeConstraints,
): VerificationSpec {
  const allowPdf = askedForPdf(taskRequirement, constraints.category) || constraints.artifact_kind === "pdf";
  const checks = spec.checks.filter((c) => {
    const pdfOnly = (PDF_GEOMETRY_CHECK_IDS as readonly string[]).includes(c.check_id);
    if (pdfOnly && !allowPdf) return false;
    return kindSupports(c.check_id, constraints.artifact_kind);
  });
  if (checks.length > 0) return { ...spec, checks };
  const fallback = sharedChecks.filter((c) => kindSupports(c.check_id, constraints.artifact_kind));
  return {
    ...spec,
    checks:
      fallback.length > 0
        ? fallback
        : [{ check_id: "artifact_exists", weight: 1, description: "A deliverable artifact is present." }],
  };
}

/**
 * Intersection of a category check map (or a declared spec) with the checks
 * implied by TASK_SPEC. Unknown / specialty categories keep their content
 * rubric but never inherit PDF-only checks unless TASK_SPEC asked for a PDF.
 */
const ZIP_RUBRIC_CHECKS: DeclaredCheck[] = [
  { check_id: "zip_valid", weight: 2, description: "The artifact parses as a ZIP archive with at least one entry." },
  { check_id: "expected_entries_present", weight: 1, description: "Named files from the brief are present in the ZIP." },
];

function mergeZipChecks(spec: VerificationSpec): VerificationSpec {
  const ids = new Set(spec.checks.map((c) => c.check_id));
  const extra = ZIP_RUBRIC_CHECKS.filter((c) => !ids.has(c.check_id));
  const checks = [...spec.checks.filter((c) => kindSupports(c.check_id, "zip")), ...extra];
  return { ...spec, checks };
}

export function scopeChecks(
  specOrMap: VerificationSpec | string,
  taskRequirement: string,
  constraints: ScopeConstraints = {},
): VerificationSpec {
  const spec = asSpec(specOrMap);
  const category = constraints.category ?? categoryFromRubric(spec.rubric_version);
  if (constraints.artifact_kind === "zip") {
    return dropPdfOnlyChecks(mergeZipChecks(spec), taskRequirement, { ...constraints, category });
  }
  if (!isKnownCategory(category)) return dropPdfOnlyChecks(spec, taskRequirement, { ...constraints, category });

  const map = defaultRubricFor(category);
  const implied = impliedCheckIds(taskRequirement, { ...constraints, category });
  const mapIds = new Set(map.checks.map((c) => c.check_id));
  const declared = spec.checks.filter((c) => mapIds.has(c.check_id));
  const pool = declared.length > 0 ? declared : map.checks;

  const kept = pool.filter((c) => implied.has(c.check_id) && kindSupports(c.check_id, constraints.artifact_kind));
  if (kept.length > 0) return { ...spec, rubric_version: spec.rubric_version, checks: kept };

  const fallback = map.checks.filter(
    (c) =>
      (SHARED_CHECK_IDS as readonly string[]).includes(c.check_id) && kindSupports(c.check_id, constraints.artifact_kind),
  );
  if (fallback.length > 0) return { ...spec, rubric_version: map.rubric_version, checks: fallback };
  const injected = sharedChecks.filter((c) => kindSupports(c.check_id, constraints.artifact_kind));
  return {
    ...spec,
    rubric_version: map.rubric_version,
    checks: injected.length > 0 ? injected : [{ check_id: "artifact_exists", weight: 1, description: "A deliverable artifact is present." }],
  };
}
