/**
 * Task classification via TypeSafe's System One model (JEV), with a deterministic
 * keyword heuristic when JEV is unavailable or clearly wrong.
 *
 * The problem it solves: the category was a hardcoded default. Every voice task fell through to
 * `html_to_pdf`, and the rubric follows the category — so a landing-page request was graded as a PDF report
 * and could never pass, because `text_matches_source >= 98%` is unsatisfiable for a page that *transforms*
 * a brief. The label was ours, not the person's.
 *
 * JEV is the right tool when it can be reached: it makes decisions, not prose. One `choice` question over
 * the requirement returns the category, **a probability for every option**, and a confidence — and all
 * questions run in parallel, so asking about ambiguity in the same call is free.
 *
 * When the key is missing, the HTTP call fails, it times out, or the choice is unrecognized, we do **not**
 * silently stamp `html_to_pdf`. Production has `TYPESAFE_API_KEY` set, so the live miss (req_4dab…) was
 * JEV returning `html_to_pdf` (or erroring into the old fallback) for a do-nothing-button landing page.
 * A *clear* keyword match therefore overrides JEV `html_to_pdf` even when the model is confident.
 *
 * The criteria are built from `TASK_CATEGORIES`, the same list the rubrics are keyed by, so the classifier
 * can never drift from the checks that will judge the result.
 */
import { TASK_CATEGORIES, isKnownCategory, type TaskCategory } from "@/lib/verification/rubric";

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_MODEL = "jev-latest";

/** What each category means, phrased as a choice criterion rather than an internal label. */
const CATEGORY_CRITERIA: Record<TaskCategory, string> = {
  html_to_pdf: "Compile or convert an existing document into a PDF, reproducing its content faithfully.",
  landing_page: "Design and build a rendered web page: a page with its own structure and calls to action.",
  dashboard: "Build an interactive view over data: metrics, filters, a primary view of a dataset.",
  research_report: "Research a question and write up findings as prose.",
};

export type ClassifySource = "jev" | "heuristic";

export type HeuristicReason =
  | "pdf_compile"
  | "landing"
  | "dashboard"
  | "research"
  | "pdf_or_convert"
  | "web_ui"
  | "prose"
  | "default";

export type TaskClassification = {
  category: TaskCategory;
  /** Confidence JEV reports for its own answer. Heuristic results are 0. */
  confidence: number;
  /** Probability of every option — the top two's gap is itself an ambiguity signal. */
  probabilities: Record<string, number>;
  /** True when the brief is too vague to verify objectively, or the category call was close. */
  ambiguous: boolean;
  /** `jev` when the model decided and we kept it; `heuristic` when keywords decided. */
  source: ClassifySource;
  /** Keyword rule that fired, when the heuristic contributed. */
  heuristic_reason?: HeuristicReason;
  /** Why JEV was overridden, when it was. */
  override?: string;
  cost_usd: number;
  latency_ms: number;
};

/** Per-million input token price; output is free on this model. */
const INPUT_PER_1M_USD = 0.042;

const LANDING_RE =
  /\b(landing(?:[\s-]?pages?)?|websites?|web\s*sites?|single[\s-]?pages?|one[\s-]?pages?|cta|call[\s-]?to[\s-]?action|buttons?)\b/i;
const PAGE_LOADS_RE = /page\s+loads/i;
const DASHBOARD_RE = /\b(dashboards?|metrics|kpis?|filters?)\b/i;
const RESEARCH_RE = /\b(research|reports?|findings?|citations?)\b/i;
const PDF_RE = /\bpdfs?\b/i;
const COMPILE_RE = /\b(compile|convert|converted|converting)\b/i;
const DOCUMENT_RE = /\b(documents?|html)\b/i;
const HTML_TO_PDF_RE = /\bhtml\s*[-_]?to\s*[-_]?pdf\b/i;
const WEB_UI_RE = /\b(html|css|webpages?|web\s*pages?|pages?|web|ui|ux|layout|hero|viewport|navbar)\b/i;
const PROSE_RE = /\b(essay|article|write(?:\s+up)?|analysis|summary|explain|prose|memo|briefing)\b/i;

function normalizeRequirement(requirement: string): string {
  return requirement.replace(/\s+/g, " ").trim();
}

function hasLandingKeywords(text: string): boolean {
  return LANDING_RE.test(text) || PAGE_LOADS_RE.test(text);
}

/** Strong convert-to-PDF language: the deliverable is a PDF even if the source is a website. */
function isPdfCompileBrief(text: string): boolean {
  if (HTML_TO_PDF_RE.test(text)) return true;
  return PDF_RE.test(text) && COMPILE_RE.test(text);
}

export type HeuristicMatch = {
  category: TaskCategory;
  reason: HeuristicReason;
  /** Keyword rule from the documented order (steps 1–5), not a last-resort guess. */
  clear: boolean;
};

/**
 * Deterministic keyword heuristic over the requirement.
 *
 * Used before/when JEV is unavailable (missing key, HTTP error, timeout, unrecognized choice),
 * and to override JEV when it returns `html_to_pdf` (or a close/low-confidence guess) on a brief
 * that clearly matches another category.
 *
 * Order (first match wins):
 *  1. Strong PDF compile language ("compile/convert … to PDF", "html to pdf") → `html_to_pdf`.
 *     A website *converted to PDF* is still a PDF job; this check runs before landing keywords.
 *  2. landing / website / single-page / CTA / button / "page loads" → `landing_page`
 *  3. dashboard / metrics / KPI / filters → `dashboard`
 *  4. research / report / findings / citations → `research_report`
 *  5. PDF / compile / convert document → `html_to_pdf`
 *  6. Still unclear:
 *     - `html_to_pdf` only when PDF language is present
 *     - `landing_page` when the brief uses web UI language
 *     - `research_report` when the brief is prose
 *     - otherwise `landing_page` (empty / silent default — never PDF without PDF words)
 */
export function inspectRequirementHeuristic(requirement: string): HeuristicMatch {
  const text = normalizeRequirement(requirement);

  if (isPdfCompileBrief(text)) return { category: "html_to_pdf", reason: "pdf_compile", clear: true };
  if (hasLandingKeywords(text)) return { category: "landing_page", reason: "landing", clear: true };
  if (DASHBOARD_RE.test(text)) return { category: "dashboard", reason: "dashboard", clear: true };
  if (RESEARCH_RE.test(text)) return { category: "research_report", reason: "research", clear: true };
  if (PDF_RE.test(text) || (COMPILE_RE.test(text) && DOCUMENT_RE.test(text))) {
    return { category: "html_to_pdf", reason: "pdf_or_convert", clear: true };
  }

  // Last resort: PDF words already handled above. Prefer landing_page or research_report
  // over html_to_pdf when PDF language is absent.
  if (WEB_UI_RE.test(text)) return { category: "landing_page", reason: "web_ui", clear: false };
  if (PROSE_RE.test(text)) return { category: "research_report", reason: "prose", clear: false };
  return { category: "landing_page", reason: "default", clear: false };
}

export function classifyRequirementHeuristic(requirement: string): TaskCategory {
  return inspectRequirementHeuristic(requirement).category;
}

function logClassify(payload: Record<string, unknown>): void {
  console.log("[classify]", JSON.stringify(payload));
}

function heuristicClassification(
  requirement: string,
  started: number,
  via: "unconfigured" | "http_error" | "unrecognized" | "error",
): TaskClassification {
  const match = inspectRequirementHeuristic(requirement);
  const result: TaskClassification = {
    category: match.category,
    confidence: 0,
    probabilities: {},
    ambiguous: false,
    source: "heuristic",
    heuristic_reason: match.reason,
    cost_usd: 0,
    latency_ms: Math.round(performance.now() - started),
  };
  logClassify({
    source: result.source,
    category: result.category,
    chosen: null,
    heuristic_reason: match.reason,
    via,
    override: null,
  });
  return result;
}

function baseUrl(): string {
  return (process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function typeSafeConfigured(): boolean {
  return Boolean((process.env.TYPESAFE_API_KEY ?? "").trim());
}

/**
 * When to prefer the keyword heuristic over JEV:
 *  - JEV said `html_to_pdf` but the brief clearly matches another category (no compile-to-PDF language).
 *    Production has a TypeSafe key; this is the live miss (landing brief → PDF agents).
 *  - The brief is a clear compile-to-PDF job and JEV picked something else.
 *  - JEV is a close call / low confidence / marked ambiguous, and the heuristic is a clear match.
 *
 * Last-resort guesses (web UI / prose / empty default) never override a decisive JEV call.
 */
function overrideReason(
  requirement: string,
  jev: { category: TaskCategory; ambiguous: boolean; confidence: number },
): { match: HeuristicMatch; override: string } | null {
  const match = inspectRequirementHeuristic(requirement);
  if (!match.clear || match.category === jev.category) return null;

  if (jev.category === "html_to_pdf" && match.category !== "html_to_pdf") {
    return { match, override: `jev_html_to_pdf_vs_clear_${match.reason}` };
  }
  if (match.reason === "pdf_compile" && jev.category !== "html_to_pdf") {
    return { match, override: `clear_pdf_compile_vs_jev_${jev.category}` };
  }
  if (jev.ambiguous || jev.confidence < 0.55) {
    return { match, override: `weak_jev_${jev.category}_vs_clear_${match.reason}` };
  }
  return null;
}

/**
 * Classify a requirement into a known category.
 *
 * Never throws: a failed or unconfigured classifier uses the keyword heuristic so the marketplace
 * keeps working and a landing brief cannot fall through to PDF. The caller decides what to do with
 * `ambiguous`.
 */
export async function classifyTask(requirement: string): Promise<TaskClassification> {
  const started = performance.now();
  const key = (process.env.TYPESAFE_API_KEY ?? "").trim();
  if (!key) return heuristicClassification(requirement, started, "unconfigured");

  const criteria: Record<string, string> = {};
  for (const category of TASK_CATEGORIES) criteria[category] = CATEGORY_CRITERIA[category];

  try {
    const res = await fetch(`${baseUrl()}/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.TYPESAFE_MODEL ?? DEFAULT_MODEL,
        state: requirement,
        questions: {
          category: {
            type: "choice",
            instructions: "What kind of deliverable does this task ask for?",
            criteria,
          },
          spec_ambiguous: {
            type: "noul",
            instructions:
              "The brief is too vague to be verified objectively — a reviewer could not decide whether the deliverable satisfies it.",
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.warn("[classify] typesafe returned", res.status);
      return heuristicClassification(requirement, started, "http_error");
    }

    const body = (await res.json()) as {
      questions?: {
        category?: { choice?: string; probabilities?: Record<string, number>; confidence?: number };
        spec_ambiguous?: { noul?: number };
      };
      usage?: { input_tokens?: number; prompt_tokens?: number };
    };

    const chosen = body.questions?.category?.choice;
    const probabilities = body.questions?.category?.probabilities ?? {};
    const confidence = Number(body.questions?.category?.confidence ?? 0);
    const ambiguityScore = Number(body.questions?.spec_ambiguous?.noul ?? 0);
    const tokens = Number(body.usage?.input_tokens ?? body.usage?.prompt_tokens ?? 0);

    // An unknown or missing choice means the model answered outside our catalogue, which is a
    // heuristic pass, not a silent html_to_pdf: an unrecognised category has no rubric.
    if (!isKnownCategory(chosen)) {
      console.warn("[classify] unrecognised category from typesafe:", chosen);
      return heuristicClassification(requirement, started, "unrecognized");
    }

    // Runner-up proximity: a 55/45 split is not a classification, it is a coin toss, and the buyer's brief
    // deserves a clarification rather than a guess that decides which checks will judge the work.
    const top = probabilities[chosen] ?? confidence;
    const runnerUp = Math.max(
      0,
      ...Object.entries(probabilities)
        .filter(([id]) => id !== chosen)
        .map(([, p]) => p),
    );
    const closeCall = top - runnerUp < 0.2;
    const ambiguous = closeCall || ambiguityScore > 0.5;
    const decided = overrideReason(requirement, { category: chosen, ambiguous, confidence });
    const result: TaskClassification = {
      category: decided ? decided.match.category : chosen,
      confidence,
      probabilities,
      ambiguous,
      source: decided ? "heuristic" : "jev",
      heuristic_reason: decided?.match.reason,
      override: decided?.override,
      cost_usd: (tokens / 1_000_000) * INPUT_PER_1M_USD,
      latency_ms: Math.round(performance.now() - started),
    };
    logClassify({
      source: result.source,
      chosen,
      category: result.category,
      probabilities,
      confidence,
      ambiguous,
      heuristic_reason: result.heuristic_reason ?? null,
      override: result.override ?? null,
      cost_usd: result.cost_usd,
      latency_ms: result.latency_ms,
    });
    return result;
  } catch (error) {
    console.warn("[classify] typesafe call failed:", error instanceof Error ? error.message : error);
    return heuristicClassification(requirement, started, "error");
  }
}
