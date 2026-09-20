/**
 * Voice task composer — wire/storage shapes.
 *
 * Deliberately separate from `@/lib/interviews/types`. The interview pool is a different product
 * (collecting structured research answers from an invited human); this is the signed-in entry point
 * where a person talks a marketplace task into existence. They share Agora primitives and UI
 * patterns, not tables or lifecycle — coupling them is how one feature takes the other down.
 */
import { z } from "zod";
import { FailurePolicy } from "@/lib/contracts";

export const VoiceSessionStatus = z.enum(["live", "completed", "replaced", "failed", "cancelled"]);
export type VoiceSessionStatus = z.infer<typeof VoiceSessionStatus>;

/**
 * The five things the agent must get out of the conversation before it may finish.
 *
 * These are exactly `RequestInput`'s 4+1 fields: the requirement plus the terms. The agent does not
 * invent them silently — it asks, then guides the human toward a combination that is actually
 * coherent (see `prompt.ts`), because a marketplace where the buyer names an impossible confidence
 * for the price is a marketplace that can only say no.
 */
export const VoiceTaskBrief = z.object({
  requirement: z.string().trim().min(1),
  max_cost_usd: z.number().positive(),
  max_latency_s: z.number().positive(),
  min_confidence: z.number().min(0).max(1),
  failure_policy: FailurePolicy,
  /** Marketplace specialty; selects the verification rubric. Defaults to the demo category. */
  category: z.string().trim().min(1).optional(),
  /** Free-form colour the agent thought worth keeping. */
  notes: z.string().trim().max(2_000).optional(),
});
export type VoiceTaskBrief = z.infer<typeof VoiceTaskBrief>;

export const TranscriptTurn = z.object({
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  at: z.number().optional(),
  uid: z.string().optional(),
  turn_id: z.number().optional(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurn>;

/**
 * What the browser sends when the conversation is over.
 *
 * The transcript is the input that matters: the brief is extracted from it server-side. `brief` is an
 * optional fast path for the case where the agent's own completion text happened to parse — never a
 * requirement, because the agent is explicitly forbidden from speaking structured data.
 */
export const VoiceFinalizeInput = z.object({
  transcript_json: z.array(TranscriptTurn).min(1).max(600),
  brief: VoiceTaskBrief.optional(),
});
export type VoiceFinalizeInput = z.infer<typeof VoiceFinalizeInput>;

/** Live transcript append from the signed-in room. Session-authed, not token-authed. */
export const VoiceTranscriptAppendInput = z.object({
  transcript_json: z.array(TranscriptTurn).min(1).max(60),
});
export type VoiceTranscriptAppendInput = z.infer<typeof VoiceTranscriptAppendInput>;

export const DEFAULT_VOICE_CATEGORY = "html_to_pdf";

/** Agent uid for the composer; kept distinct from the interview agent's. */
export const VOICE_AGENT_UID = 123457;
