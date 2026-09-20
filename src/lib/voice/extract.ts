/**
 * Recover the task brief from a finished conversation.
 *
 * The agent must **never speak structured data**. Asking a voice model to dictate JSON produced exactly
 * what you would expect: TTS/ASR mangled it (`{"requirement" Criar…` — the colon gone, quotes broken),
 * the client could not parse it, and the call ended with the agent apologising — *"desculpa, vou ditar
 * de novo… só um minutinho"* — and no task.
 *
 * So the structure is recovered where it is reliable: in text, on the server, from the transcript. The
 * interview module already proved this pattern (`extractWithLlm`); this is the same idea for the brief.
 */
import { env } from "@/lib/env";
import { runInference } from "@/lib/observability/inference";
import type { TranscriptTurn } from "@/lib/agora/rtm";
import { DEFAULT_VOICE_CATEGORY, VoiceTaskBrief } from "./types";

/** Render the conversation as plain lines, capped: a long call must not produce an unbounded prompt. */
export function transcriptToPrompt(turns: TranscriptTurn[], maxChars = 8_000): string {
  const text = turns
    .map((turn) => `${turn.role === "user" ? "HUMAN" : "AGENT"}: ${turn.text}`)
    .join("\n")
    .trim();
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/**
 * Pull the last JSON object out of a model reply.
 *
 * Scans from the end for the outermost `{…}` so trailing prose does not defeat the parse, and returns
 * null on anything unparseable rather than throwing.
 */
export function extractLastJsonObject(text: string): unknown | null {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  const start = text.lastIndexOf("{", end);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SYSTEM = [
  "You convert a spoken conversation into a marketplace task brief.",
  "Reply with JSON only. No prose, no markdown fences.",
  'Shape: {"requirement":"<what must be delivered, specific enough to be objectively checked>",',
  '"max_cost_usd":<number>,"max_latency_s":<number>,"min_confidence":<number 0..1>,',
  '"failure_policy":"refund|discount|accept_flagged","category":"<optional>","notes":"<optional, one line>"}',
  "Rules:",
  "- Use only what the conversation supports. Never invent a number the human did not agree to.",
  "- `requirement` must describe the deliverable, not the conversation.",
  "- `min_confidence` is a fraction between 0 and 1 (95% is 0.95).",
  "- If the conversation does not specify a term, choose the platform default and say so in `notes`.",
].join("\n");

/**
 * Ask the model for the brief.
 *
 * Returns null when inference is unavailable or the reply does not validate — the caller decides what
 * to tell the human. It deliberately does not throw: this runs at the end of a call whose transcript is
 * already persisted, and a failed extraction must not lose the conversation.
 */
export async function extractBriefFromTranscript(turns: TranscriptTurn[]): Promise<VoiceTaskBrief | null> {
  if (!env.modelProvider.enabled || turns.length === 0) return null;

  let result;
  try {
    result = await runInference({
      agent_id: "voice-extract",
      purpose: "voice_brief_extract",
      system: SYSTEM,
      prompt: `Conversation:\n${transcriptToPrompt(turns)}`,
      maxOutputTokens: 500,
    });
  } catch (error) {
    console.error("[voice] brief extraction failed:", error);
    return null;
  }
  if (!result.text) return null;

  const parsed = extractLastJsonObject(result.text);
  if (!parsed || typeof parsed !== "object") return null;

  const brief = VoiceTaskBrief.safeParse(parsed);
  if (!brief.success) {
    console.warn("[voice] extracted brief did not validate:", brief.error.flatten());
    return null;
  }
  return { ...brief.data, category: brief.data.category ?? DEFAULT_VOICE_CATEGORY };
}
