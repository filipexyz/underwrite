/**
 * Wire/storage shapes for the human interview pool.
 * Status enums match the `interview_needs` / `interview_sessions` columns.
 */
import { z } from "zod";

export const InterviewNeedStatus = z.enum(["open", "in_progress", "completed", "cancelled"]);
export type InterviewNeedStatus = z.infer<typeof InterviewNeedStatus>;

export const InterviewSessionStatus = z.enum(["live", "completed", "failed"]);
export type InterviewSessionStatus = z.infer<typeof InterviewSessionStatus>;

/**
 * Budget and SLA the creator commits to when registering a need.
 *
 * These are the 4+1 request fields minus the requirement itself. They live on the brief because they
 * are a *business* decision the creator makes up front — the interview captures what the work is, not
 * what it may cost. Keeping them here is what makes the interview→task handoff deterministic instead
 * of guessed at the end of a call.
 */
export const InterviewTaskTerms = z.object({
  max_cost_usd: z.number().positive().default(0.05),
  max_latency_s: z.number().positive().default(30),
  min_confidence: z.number().min(0).max(1).default(0.95),
  failure_policy: z.enum(["refund", "discount", "accept_flagged"]).default("refund"),
  /** Marketplace specialty; selects the verification rubric. */
  category: z.string().trim().min(1).default("html_to_pdf"),
  /** `push` = real marketplace, `seed` = demo catalog. Omit to follow MARKETPLACE_PUSH. */
  execution_mode: z.enum(["seed", "push"]).optional(),
  /** Pin the auction to specific agents (used by the hosted-agent test area). */
  invite_agent_ids: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
});
export type InterviewTaskTerms = z.infer<typeof InterviewTaskTerms>;

export const InterviewBrief = z.object({
  goal: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
  context: z.string().default(""),
  required_fields: z.array(z.string().min(1)).min(1),
  success_criteria: z.string().default(""),
  /** Optional so briefs written before this existed still parse. */
  task: InterviewTaskTerms.optional(),
});
export type InterviewBrief = z.infer<typeof InterviewBrief>;

export const CreateNeedInput = z.object({
  title: z.string().trim().min(1).max(200),
  brief: InterviewBrief,
});
export type CreateNeedInput = z.infer<typeof CreateNeedInput>;

export const TranscriptTurn = z.object({
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  at: z.number().optional(),
  uid: z.string().optional(),
  turn_id: z.number().optional(),
});
export type TranscriptTurn = z.infer<typeof TranscriptTurn>;

export const InterviewAnswers = z.object({
  answers: z.record(z.string(), z.string()),
  notes: z.string().optional(),
  source: z.enum(["agent_json", "client", "llm_extract", "partial"]).optional(),
});
export type InterviewAnswers = z.infer<typeof InterviewAnswers>;

export const FinalizeSessionInput = z.object({
  transcript_json: z.array(TranscriptTurn).optional(),
  answers_json: InterviewAnswers.or(z.record(z.string(), z.unknown())).optional(),
});
export type FinalizeSessionInput = z.infer<typeof FinalizeSessionInput>;

/**
 * Live transcript append (public invite token).
 *
 * Capped in the schema as well as in the store, so an oversized body is rejected before it reaches the
 * database rather than truncated silently. `status` is intentionally absent: a transcript push must not
 * be able to finish or reopen a session.
 */
export const TranscriptAppendInput = z.object({
  transcript_json: z.array(TranscriptTurn).min(1).max(60),
});
export type TranscriptAppendInput = z.infer<typeof TranscriptAppendInput>;

export const DEFAULT_AGENT_UID = 123456;
