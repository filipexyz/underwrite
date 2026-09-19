import type { InterviewAnswers, TranscriptTurn } from "./types";

/** Walk backwards and return the last balanced `{...}` object in `text`, if any. */
export function extractLastJsonObject(text: string): unknown | null {
  const source = text.trim();
  if (!source) return null;

  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/gi);
  const candidates: string[] = [];
  if (fenced) {
    for (const block of fenced) {
      const inner = block.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
      if (inner.startsWith("{")) candidates.push(inner);
    }
  }

  let depth = 0;
  let end = -1;
  for (let i = source.length - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") {
      if (depth === 0) end = i;
      depth += 1;
    } else if (ch === "{") {
      depth -= 1;
      if (depth === 0 && end >= i) {
        candidates.push(source.slice(i, end + 1));
        break;
      }
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]);
    } catch {
      /* try earlier candidate */
    }
  }
  return null;
}

function asStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string") out[key] = raw;
    else if (typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
    else out[key] = JSON.stringify(raw);
  }
  return out;
}

function pickNotes(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const notes = (value as { notes?: unknown }).notes;
  return typeof notes === "string" && notes.trim() ? notes.trim() : undefined;
}

/**
 * Accepts either `{ answers: {...}, notes? }` or a flat field map.
 * Required field names are matched case-insensitively; stored keys stay canonical.
 */
export function normalizeAnswers(raw: unknown, requiredFields: string[]): InterviewAnswers | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const nested = asStringRecord(obj.answers) ?? asStringRecord(obj);
  if (!nested) return null;

  const byLower = new Map(Object.entries(nested).map(([k, v]) => [k.toLowerCase(), v]));
  const answers: Record<string, string> = {};
  let filled = 0;
  for (const field of requiredFields) {
    const value = byLower.get(field.toLowerCase());
    if (value && value.trim()) {
      answers[field] = value.trim();
      filled += 1;
    }
  }
  if (filled === 0 && Object.keys(nested).length === 0) return null;
  if (filled === 0) {
    return { answers: nested, notes: pickNotes(obj), source: "partial" };
  }
  return {
    answers,
    notes: pickNotes(obj),
    source: filled === requiredFields.length ? "agent_json" : "partial",
  };
}

export function extractAnswersFromTranscript(
  transcript: TranscriptTurn[],
  requiredFields: string[],
): InterviewAnswers | null {
  const assistantText = transcript
    .filter((t) => t.role === "assistant")
    .map((t) => t.text)
    .join("\n");
  const parsed = extractLastJsonObject(assistantText);
  return parsed === null ? null : normalizeAnswers(parsed, requiredFields);
}

/** Required brief fields that are still empty after normalize. */
export function missingRequiredFields(
  answers: InterviewAnswers | null | undefined,
  requiredFields: string[],
): string[] {
  if (!answers) return [...requiredFields];
  return requiredFields.filter((field) => !answers.answers[field]?.trim());
}

export function answersCoverRequiredFields(
  answers: InterviewAnswers | null | undefined,
  requiredFields: string[],
): answers is InterviewAnswers {
  return missingRequiredFields(answers, requiredFields).length === 0;
}

export function transcriptToPrompt(transcript: TranscriptTurn[]): string {
  return transcript
    .map((t) => `${t.role}: ${t.text}`)
    .join("\n")
    .slice(0, 12_000);
}
