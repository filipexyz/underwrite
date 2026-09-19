import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  interviewNeeds,
  interviewSessions,
  type InterviewNeedRow,
  type InterviewSessionRow,
} from "@/lib/db/schema";
import { newId, newInviteToken } from "@/lib/ids";
import { extractAnswersFromTranscript, normalizeAnswers, transcriptToPrompt } from "./extract";
import { runInference } from "@/lib/observability/inference";
import { env } from "@/lib/env";
import type { CreateNeedInput, InterviewAnswers, InterviewNeedStatus, TranscriptTurn } from "./types";

export function toApiNeed(row: InterviewNeedRow, sessions?: InterviewSessionRow[]) {
  return {
    id: row.id,
    title: row.title,
    brief: row.brief,
    status: row.status,
    created_by_clerk_user_id: row.createdByClerkUserId,
    assigned_session_id: row.assignedSessionId,
    public_token: row.publicToken,
    invite_path: `/i/${row.publicToken}`,
    result_json: row.resultJson,
    created_at: row.createdAt.toISOString(),
    completed_at: row.completedAt?.toISOString() ?? null,
    sessions: sessions?.map(toApiSession),
  };
}

export function toApiSession(row: InterviewSessionRow) {
  return {
    id: row.id,
    need_id: row.needId,
    agora_channel: row.agoraChannel,
    agora_agent_id: row.agoraAgentId,
    status: row.status,
    transcript_json: row.transcriptJson,
    answers_json: row.answersJson,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt?.toISOString() ?? null,
  };
}

export async function createNeed(db: Db, input: CreateNeedInput, createdBy: string): Promise<InterviewNeedRow> {
  const [row] = await db
    .insert(interviewNeeds)
    .values({
      id: newId("need"),
      title: input.title.trim(),
      brief: input.brief,
      status: "open",
      createdByClerkUserId: createdBy,
      publicToken: newInviteToken(),
    })
    .returning();
  return row;
}

export async function listNeeds(db: Db, limit = 50): Promise<InterviewNeedRow[]> {
  return db
    .select()
    .from(interviewNeeds)
    .orderBy(desc(interviewNeeds.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getNeed(db: Db, id: string): Promise<InterviewNeedRow | undefined> {
  const [row] = await db.select().from(interviewNeeds).where(eq(interviewNeeds.id, id)).limit(1);
  return row;
}

export async function getNeedByToken(db: Db, token: string): Promise<InterviewNeedRow | undefined> {
  const [row] = await db.select().from(interviewNeeds).where(eq(interviewNeeds.publicToken, token)).limit(1);
  return row;
}

export function toPublicNeed(row: InterviewNeedRow) {
  return {
    title: row.title,
    status: row.status,
    completed: row.status === "completed" || row.status === "cancelled",
  };
}

export async function listSessionsForNeed(db: Db, needId: string): Promise<InterviewSessionRow[]> {
  return db.select().from(interviewSessions).where(eq(interviewSessions.needId, needId)).orderBy(desc(interviewSessions.startedAt));
}

export async function getNeedDetail(db: Db, id: string) {
  const need = await getNeed(db, id);
  if (!need) return null;
  const sessions = await listSessionsForNeed(db, id);
  return { need, sessions };
}

export async function insertLiveSession(
  db: Db,
  need: InterviewNeedRow,
  agoraChannel: string,
  sessionId = newId("sess"),
): Promise<InterviewSessionRow> {
  const [session] = await db
    .insert(interviewSessions)
    .values({
      id: sessionId,
      needId: need.id,
      agoraChannel,
      status: "live",
    })
    .returning();

  await db
    .update(interviewNeeds)
    .set({ status: "in_progress", assignedSessionId: session.id })
    .where(eq(interviewNeeds.id, need.id));

  return session;
}

export async function attachAgentId(db: Db, sessionId: string, agoraAgentId: string): Promise<void> {
  await db.update(interviewSessions).set({ agoraAgentId }).where(eq(interviewSessions.id, sessionId));
}

export async function markSessionFailed(db: Db, sessionId: string, needId: string, revertNeedIfOpen: boolean): Promise<void> {
  await db.update(interviewSessions).set({ status: "failed", endedAt: new Date() }).where(eq(interviewSessions.id, sessionId));
  if (revertNeedIfOpen) {
    await db
      .update(interviewNeeds)
      .set({ status: "open", assignedSessionId: null })
      .where(eq(interviewNeeds.id, needId));
  }
}

export async function getSession(db: Db, id: string): Promise<InterviewSessionRow | undefined> {
  const [row] = await db.select().from(interviewSessions).where(eq(interviewSessions.id, id)).limit(1);
  return row;
}

async function extractWithLlm(transcript: TranscriptTurn[], requiredFields: string[]): Promise<InterviewAnswers | null> {
  if (!env.modelProvider.enabled || transcript.length === 0) return null;
  const result = await runInference({
    agent_id: "interview-extract",
    model: "auto",
    purpose: "interview_extract",
    system: "Extract structured interview answers. Reply with JSON only: {\"answers\":{...},\"notes\":\"\"}.",
    prompt: `Required fields: ${requiredFields.join(", ")}\n\nTranscript:\n${transcriptToPrompt(transcript)}`,
    simulated: { in: 200, out: 120 },
    fallbackText: "",
    maxOutputTokens: 400,
  });
  if (result.simulated || !result.text) return null;
  const { extractLastJsonObject } = await import("./extract");
  const parsed = extractLastJsonObject(result.text);
  const normalized = parsed === null ? null : normalizeAnswers(parsed, requiredFields);
  if (!normalized) return null;
  return { ...normalized, source: "llm_extract" };
}

export async function finalizeSession(
  db: Db,
  session: InterviewSessionRow,
  input: { transcript_json?: TranscriptTurn[]; answers_json?: unknown },
): Promise<{ session: InterviewSessionRow; need: InterviewNeedRow; answers: InterviewAnswers | null }> {
  const need = await getNeed(db, session.needId);
  if (!need) throw new Error(`need not found for session ${session.id}`);

  const transcript = input.transcript_json ?? session.transcriptJson ?? [];
  let answers =
    (input.answers_json ? normalizeAnswers(input.answers_json, need.brief.required_fields) : null) ??
    extractAnswersFromTranscript(transcript, need.brief.required_fields);

  if (answers && input.answers_json) answers = { ...answers, source: answers.source === "partial" ? "partial" : "client" };
  if (!answers) answers = await extractWithLlm(transcript, need.brief.required_fields);

  const endedAt = new Date();
  const [updatedSession] = await db
    .update(interviewSessions)
    .set({
      status: "completed",
      transcriptJson: transcript,
      answersJson: answers ?? null,
      endedAt,
    })
    .where(eq(interviewSessions.id, session.id))
    .returning();

  const terminal: InterviewNeedStatus = "completed";
  const [updatedNeed] = await db
    .update(interviewNeeds)
    .set({
      status: terminal,
      resultJson: answers ?? null,
      completedAt: endedAt,
      assignedSessionId: session.id,
    })
    .where(eq(interviewNeeds.id, need.id))
    .returning();

  return { session: updatedSession, need: updatedNeed, answers };
}
