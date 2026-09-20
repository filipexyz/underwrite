/**
 * GET /api/v1/voice/sessions/[id] — poll a conversation's state.
 *
 * The composer polls this so the person can see the task id appear the moment the agent finishes,
 * without a websocket. Every read is scoped to the signed-in user.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getVoiceSession, toApiVoiceSession } from "@/lib/voice/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { db } = await getDb();
  const session = await getVoiceSession(db, id, auth.identity.userId);
  if (!session) return jsonError(404, "session not found");

  const turns = session.transcriptJson ?? [];
  const after = Math.max(0, Number(new URL(_request.url).searchParams.get("after") ?? 0) || 0);

  return NextResponse.json({
    ...toApiVoiceSession(session),
    /** Absolute turn count, so a client can advance its cursor even across the rolling window. */
    total: turns.length,
    from: Math.min(after, turns.length),
    turns: after >= turns.length ? [] : turns.slice(after),
  });
}
