/**
 * Wire/storage shapes for the human interview pool.
 * Status enums match the `interview_needs` / `interview_sessions` columns.
 */
import { z } from "zod";

export const InterviewNeedStatus = z.enum(["open", "in_progress", "completed", "cancelled"]);
export type InterviewNeedStatus = z.infer<typeof InterviewNeedStatus>;

export const InterviewSessionStatus = z.enum(["live", "completed", "failed"]);
export type InterviewSessionStatus = z.infer<typeof InterviewSessionStatus>;

export const InterviewBrief = z.object({
  goal: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
  context: z.string().default(""),
  required_fields: z.array(z.string().min(1)).min(1),
  success_criteria: z.string().default(""),
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

export const DEFAULT_AGENT_UID = 123456;
