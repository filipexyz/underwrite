/**
 * Task classification via TypeSafe's System One model (JEV).
 *
 * The problem it solves: the category was a hardcoded default. Every voice task fell through to
 * `html_to_pdf`, and the rubric follows the category — so a landing-page request was graded as a PDF report
 * and could never pass, because `text_matches_source >= 98%` is unsatisfiable for a page that *transforms*
 * a brief. The label was ours, not the person's.
 *
 * JEV is the right tool: it makes decisions, not prose. One `choice` question over the requirement returns
 * the category, **a probability for every option**, and a confidence — and all questions run in parallel, so
 * asking about ambiguity in the same call is free.
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

export type TaskClassification = {
  category: TaskCategory;
  /** Confidence JEV reports for its own answer. */
  confidence: number;
  /** Probability of every option — the top two's gap is itself an ambiguity signal. */
  probabilities: Record<string, number>;
  /** True when the brief is too vague to verify objectively, or the category call was close. */
  ambiguous: boolean;
  /** 'jev' when the model decided; 'fallback' when it could not be reached. */
  source: "jev" | "fallback";
  cost_usd: number;
  latency_ms: number;
};

const FALLBACK: Omit<TaskClassification, "latency_ms"> = {
  category: "html_to_pdf",
  confidence: 0,
  probabilities: {},
  ambiguous: false,
  source: "fallback",
  cost_usd: 0,
};

/** Per-million input token price; output is free on this model. */
const INPUT_PER_1M_USD = 0.042;

function baseUrl(): string {
  return (process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function typeSafeConfigured(): boolean {
  return Boolean((process.env.TYPESAFE_API_KEY ?? "").trim());
}

/**
 * Classify a requirement into a known category.
 *
 * Never throws: a failed or unconfigured classifier falls back to the previous default, so the marketplace
 * keeps working — it just loses the improvement. The caller decides what to do with `ambiguous`.
 */
export async function classifyTask(requirement: string): Promise<TaskClassification> {
  const started = performance.now();
  const key = (process.env.TYPESAFE_API_KEY ?? "").trim();
  if (!key) return { ...FALLBACK, latency_ms: Math.round(performance.now() - started) };

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
      return { ...FALLBACK, latency_ms: Math.round(performance.now() - started) };
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

    // An unknown or missing choice means the model answered outside our catalogue, which is a fallback,
    // not a silent pass-through: an unrecognised category has no rubric.
    if (!isKnownCategory(chosen)) {
      console.warn("[classify] unrecognised category from typesafe:", chosen);
      return { ...FALLBACK, latency_ms: Math.round(performance.now() - started) };
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

    return {
      category: chosen,
      confidence,
      probabilities,
      ambiguous: closeCall || ambiguityScore > 0.5,
      source: "jev",
      cost_usd: (tokens / 1_000_000) * INPUT_PER_1M_USD,
      latency_ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    console.warn("[classify] typesafe call failed:", error instanceof Error ? error.message : error);
    return { ...FALLBACK, latency_ms: Math.round(performance.now() - started) };
  }
}
