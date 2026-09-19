import { chatCompletion, extractJsonObject } from "./neuralake";
import type { JobConstraints, JobPlanInput, PlanRequestEvent } from "./protocol";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function asFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function clampPlanToConstraints(draft: JobPlanInput, constraints: JobConstraints): JobPlanInput {
  const price = clamp(draft.price_usd, 0, constraints.max_cost_usd);
  const latency = clamp(draft.max_latency_s, 0.5, constraints.max_latency_s);
  const confidence = clamp(Math.max(draft.promised_confidence, constraints.min_confidence), 0, 1);
  return {
    ...draft,
    price_usd: Number(price.toFixed(6)),
    max_latency_s: Number(latency.toFixed(3)),
    promised_confidence: Number(confidence.toFixed(4)),
  };
}

export function parsePlanDraft(raw: unknown): JobPlanInput | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const price = asFinite(row.price_usd);
  const confidence = asFinite(row.promised_confidence);
  const latency = asFinite(row.max_latency_s);
  if (price === undefined || confidence === undefined || latency === undefined) return null;
  const steps = Array.isArray(row.steps)
    ? row.steps.filter((s): s is string => typeof s === "string")
    : typeof row.steps === "string"
      ? row.steps
      : undefined;
  return {
    approach: typeof row.approach === "string" ? row.approach : undefined,
    steps,
    price_usd: price,
    promised_confidence: confidence,
    max_latency_s: latency,
    deliverable: typeof row.deliverable === "string" ? row.deliverable : undefined,
    rationale: typeof row.rationale === "string" ? row.rationale : undefined,
  };
}

export async function draftPlanWithNeuralake(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  event: PlanRequestEvent;
  signal?: AbortSignal;
}): Promise<JobPlanInput> {
  const { event } = args;
  const fileNames = event.brief.files.map((f) => `${f.name} (${f.media_type}, ${f.content.length} chars)`).join(", ");
  const completion = await chatCompletion({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    signal: args.signal,
    maxTokens: 350,
    messages: [
      {
        role: "system",
        content:
          "You are a hireable seller agent on the Underwrite marketplace. Reply with a single JSON object only. No markdown.",
      },
      {
        role: "user",
        content: [
          "Draft exactly one JobPlanInput for this push job. Single price — there is no reprice.",
          "Required JSON keys: approach (string), steps (string[]), price_usd (number), promised_confidence (number 0-1), max_latency_s (number), deliverable (string), rationale (string).",
          `Buyer constraints: max_cost_usd=${event.constraints.max_cost_usd}, max_latency_s=${event.constraints.max_latency_s}, min_confidence=${event.constraints.min_confidence}, category=${event.constraints.category ?? "html_to_pdf"}.`,
          `Stay inside the constraints. Prefer a high-confidence bid (selection is best-score, not cheapest).`,
          `Requirement: ${event.brief.requirement}`,
          `Files: ${fileNames || "(none)"}`,
          `plan_deadline_at: ${event.plan_deadline_at}`,
        ].join("\n"),
      },
    ],
  });
  const parsed = parsePlanDraft(extractJsonObject(completion.text));
  if (!parsed) {
    throw new Error("NeuraLake plan JSON did not match JobPlanInput (price_usd, promised_confidence, max_latency_s)");
  }
  return clampPlanToConstraints(parsed, event.constraints);
}
