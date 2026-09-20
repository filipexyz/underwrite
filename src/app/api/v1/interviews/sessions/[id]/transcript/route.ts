/**
 * GET /api/v1/interviews/sessions/[id]/transcript?after=<n> — creator-side live transcript.
 *
 * Session-authed (the creator watching the call). `after` is an index into the stored window, so the
 * caller can poll for just the new turns. Returns the session status alongside, so the page knows when
 * to stop polling without a second request.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { requireInterviewUser } from "@/lib/interviews/auth";
import { getNeed, getSession } from "@/lib/interviews/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;

  const { id } = await params;
  const { db } = await getDb();
  const session = await getSession(db, id);
  if (!session) return jsonError(404, `session not found: ${id}`);

  // Ownership: the session belongs to a need, and the need to its creator. Without this, any signed-in
  // account could read any interview by guessing a session id.
  const need = await getNeed(db, session.needId);
  if (!need) return jsonError(404, "need not found for session");
  if (need.createdByUserId !== actor.userId) return jsonError(404, `session not found: ${id}`);

  const turns = session.transcriptJson ?? [];
  const after = Math.max(0, Number(new URL(request.url).searchParams.get("after") ?? 0) || 0);

  return NextResponse.json({
    session_id: session.id,
    status: session.status,
    total: turns.length,
    /** Absolute index of the first returned turn, so the client can advance its cursor correctly. */
    from: Math.min(after, turns.length),
    turns: after >= turns.length ? [] : turns.slice(after),
  });
}
