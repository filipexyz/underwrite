/**
 * Task classification via TypeSafe's System One model (JEV), with a deterministic
 * keyword heuristic when JEV is unavailable.
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
 * silently stamp `html_to_pdf`. That is how a “literally nothing + do-nothing button” landing brief hired
 * PDF agents. The heuristic below reads the requirement instead.
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

/**
 * Deterministic keyword heuristic over the requirement.
 *
 * Used before/when JEV is unavailable (missing key, HTTP error, timeout, unrecognized choice),
 * and to override a weak JEV `html_to_pdf` guess on a clear landing brief.
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
export function classifyRequirementHeuristic(requirement: string): TaskCategory {
  const text = normalizeRequirement(requirement);

  if (isPdfCompileBrief(text)) return "html_to_pdf";
  if (hasLandingKeywords(text)) return "landing_page";
  if (DASHBOARD_RE.test(text)) return "dashboard";
  if (RESEARCH_RE.test(text)) return "research_report";
  if (PDF_RE.test(text) || (COMPILE_RE.test(text) && DOCUMENT_RE.test(text))) return "html_to_pdf";

  // Last resort: PDF words already handled above. Prefer landing_page or research_report
  // over html_to_pdf when PDF language is absent.
  if (WEB_UI_RE.test(text)) return "landing_page";
  if (PROSE_RE.test(text)) return "research_report";
  return "landing_page";
}

function heuristicClassification(requirement: string, started: number): TaskClassification {
  return {
    category: classifyRequirementHeuristic(requirement),
    confidence: 0,
    probabilities: {},
    ambiguous: false,
    source: "heuristic",
    cost_usd: 0,
    latency_ms: Math.round(performance.now() - started),
  };
}

function baseUrl(): string {
  return (process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function typeSafeConfigured(): boolean {
  return Boolean((process.env.TYPESAFE_API_KEY ?? "").trim());
}

/**
 * Keep JEV when it is decisive. Prefer the heuristic when a close/ambiguous JEV call
 * guessed `html_to_pdf` on a brief that is clearly a landing page — that is the live
 * failure mode (PDF agents invited for a do-nothing-button page).
 */
function resolveJevAgainstHeuristic(
  requirement: string,
  jev: Omit<TaskClassification, "latency_ms" | "source"> & { source?: ClassifySource },
  started: number,
): TaskClassification {
  const keepJev: TaskClassification = {
    ...jev,
    source: "jev",
    latency_ms: Math.round(performance.now() - started),
  };
  if (!jev.ambiguous) return keepJev;
  if (jev.category !== "html_to_pdf") return keepJev;
  if (!hasLandingKeywords(requirement)) return keepJev;
  return {
    ...keepJev,
    category: "landing_page",
    source: "heuristic",
  };
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
  if (!key) return heuristicClassification(requirement, started);

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
      return heuristicClassification(requirement, started);
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
      return heuristicClassification(requirement, started);
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

    return resolveJevAgainstHeuristic(
      requirement,
      {
        category: chosen,
        confidence,
        probabilities,
        ambiguous: closeCall || ambiguityScore > 0.5,
        cost_usd: (tokens / 1_000_000) * INPUT_PER_1M_USD,
      },
      started,
    );
  } catch (error) {
    console.warn("[classify] typesafe call failed:", error instanceof Error ? error.message : error);
    return heuristicClassification(requirement, started);
  }
}
