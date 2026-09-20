/**
 * Voice task composer — storage.
 *
 * One table (`voice_sessions`), owned by the signed-in user. Every read is scoped by `userId`: this is
 * a private surface, so a session id alone must never be enough to read someone else's conversation or
 * the task it produced.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { voiceSessions, type VoiceSessionRow } from "@/lib/db/schema";
import { upsertTranscript } from "@/lib/agora/rtm";
import { newId } from "@/lib/ids";
import type { TranscriptTurn, VoiceSessionStatus, VoiceTaskBrief } from "./types";

/** Rolling window, same reasoning as the interview transcript: bounded storage on a live path. */
export const MAX_VOICE_TRANSCRIPT_TURNS = 600;
export const MAX_VOICE_TRANSCRIPT_TURNS_PER_WRITE = 60;

export function toApiVoiceSession(row: VoiceSessionRow) {
  return {
    session_id: row.id,
    status: row.status as VoiceSessionStatus,
    channel: row.agoraChannel,
    request_id: row.requestId,
    brief: row.briefJson ?? null,
    error: row.error,
    transcript_turns: row.transcriptJson?.length ?? 0,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

export async function listVoiceSessions(db: Db, userId: string, limit = 25): Promise<VoiceSessionRow[]> {
  return db
    .select()
    .from(voiceSessions)
    .where(eq(voiceSessions.userId, userId))
    .orderBy(desc(voiceSessions.startedAt))
    .limit(limit);
}

export async function getVoiceSession(db: Db, id: string, userId: string): Promise<VoiceSessionRow | undefined> {
  const [row] = await db
    .select()
    .from(voiceSessions)
    .where(and(eq(voiceSessions.id, id), eq(voiceSessions.userId, userId)))
    .limit(1);
  return row;
}

export async function insertVoiceSession(db: Db, args: { userId: string; channel: string }): Promise<VoiceSessionRow> {
  const [row] = await db
    .insert(voiceSessions)
    .values({ id: newId("voice"), userId: args.userId, status: "live", agoraChannel: args.channel })
    .returning();
  return row;
}

export async function attachVoiceAgentId(db: Db, id: string, agoraAgentId: string): Promise<void> {
  await db.update(voiceSessions).set({ agoraAgentId }).where(eq(voiceSessions.id, id));
}

/**
 * Append turns to a live session.
 *
 * Merges through the shared `upsertTranscript`, so a re-sent in-progress agent turn updates its entry
 * instead of duplicating — which is what makes it safe for the room to push on a timer.
 */
export async function appendVoiceTranscript(
  db: Db,
  id: string,
  incoming: TranscriptTurn[],
): Promise<{ turns: TranscriptTurn[]; skipped: number }> {
  const [session] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, id)).limit(1);
  if (!session) return { turns: [], skipped: incoming.length };
  // A finished session is frozen: a late push from a reconnecting browser must not reopen it.
  if (session.status !== "live") return { turns: session.transcriptJson ?? [], skipped: incoming.length };

  let turns = session.transcriptJson ?? [];
  let skipped = 0;
  for (const turn of incoming.slice(0, MAX_VOICE_TRANSCRIPT_TURNS_PER_WRITE)) {
    const text = typeof turn.text === "string" ? turn.text : "";
    if (!text.trim()) {
      skipped += 1;
      continue;
    }
    turns = upsertTranscript(turns, { ...turn, text }, false);
  }
  if (incoming.length > MAX_VOICE_TRANSCRIPT_TURNS_PER_WRITE) {
    skipped += incoming.length - MAX_VOICE_TRANSCRIPT_TURNS_PER_WRITE;
  }
  if (turns.length > MAX_VOICE_TRANSCRIPT_TURNS) turns = turns.slice(turns.length - MAX_VOICE_TRANSCRIPT_TURNS);

  await db.update(voiceSessions).set({ transcriptJson: turns }).where(eq(voiceSessions.id, id));
  return { turns, skipped };
}

export async function completeVoiceSession(
  db: Db,
  id: string,
  args: { brief: VoiceTaskBrief; transcript?: TranscriptTurn[]; requestId: string },
): Promise<VoiceSessionRow | undefined> {
  const [row] = await db
    .update(voiceSessions)
    .set({
      status: "completed",
      briefJson: args.brief,
      requestId: args.requestId,
      transcriptJson: args.transcript,
      endedAt: new Date(),
      error: null,
    })
    .where(eq(voiceSessions.id, id))
    .returning();
  return row;
}

export async function failVoiceSession(
  db: Db,
  id: string,
  args: { error: string; transcript?: TranscriptTurn[] },
): Promise<void> {
  await db
    .update(voiceSessions)
    .set({ status: "failed", error: args.error.slice(0, 500), transcriptJson: args.transcript, endedAt: new Date() })
    .where(eq(voiceSessions.id, id));
}

export async function cancelVoiceSessionsForUser(db: Db, userId: string): Promise<VoiceSessionRow[]> {
  return db
    .select()
    .from(voiceSessions)
    .where(and(eq(voiceSessions.userId, userId), eq(voiceSessions.status, "live")));
}
