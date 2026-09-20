/**
 * POST /api/v1/interviews/i/[token]/transcript — live transcript append.
 *
 * The interviewee's browser already has the transcript; without this endpoint the creator cannot see
 * anything until the call ends, because turns only reached the database at `finalize`. This is the
 * write path that makes the creator's page live.
 *
 * Auth is the invite token, same as the rest of `/i/[token]` — possession of the link is the auth.
 * Because that makes this an unauthenticated write, it is deliberately narrow: a bounded number of
 * turns per request, a rolling window stored per session, and only `role`/`text`/`turn_id`/`at`/`uid`
 * survive validation. `status` is never accepted from the client — a transcript push must not be able
 * to complete or reopen a session.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import {
  MAX_TRANSCRIPT_TURNS_PER_WRITE,
  appendTranscriptTurns,
  getNeedByToken,
  listSessionsForNeed,
} from "@/lib/interviews/store";
import { TranscriptAppendInput } from "@/lib/interviews/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = TranscriptAppendInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid transcript payload", parsed.error.flatten());

  const { db } = await getDb();
  const need = await getNeedByToken(db, token);
  if (!need) return jsonError(404, "interview link not found");
  if (need.status === "completed" || need.status === "cancelled") {
    return jsonError(410, "this interview is already finished");
  }

  const sessions = await listSessionsForNeed(db, need.id);
  const session =
    sessions.find((s) => s.id === need.assignedSessionId && s.status === "live") ??
    sessions.find((s) => s.status === "live");
  if (!session) return jsonError(409, "no live session — start the interview first");

  const { turns, skipped } = await appendTranscriptTurns(db, session.id, parsed.data.transcript_json);

  return NextResponse.json({
    session_id: session.id,
    turns: turns.length,
    skipped,
    limit_per_write: MAX_TRANSCRIPT_TURNS_PER_WRITE,
  });
}
