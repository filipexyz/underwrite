/**
 * POST /api/v1/voice/sessions/[id]/transcript — live transcript append.
 *
 * Signed-in and owner-scoped, unlike the interview's public token variant: this surface has a real
 * session, so there is no reason to accept an unauthenticated write.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { appendVoiceTranscript, getVoiceSession } from "@/lib/voice/store";
import { VoiceTranscriptAppendInput } from "@/lib/voice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = VoiceTranscriptAppendInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid transcript payload", parsed.error.flatten());

  const { id } = await params;
  const { db } = await getDb();
  const session = await getVoiceSession(db, id, auth.identity.userId);
  if (!session) return jsonError(404, "session not found");
  if (session.status !== "live") return jsonError(409, `session is ${session.status}`);

  const { turns, skipped } = await appendVoiceTranscript(db, id, parsed.data.transcript_json);
  return NextResponse.json({ session_id: id, turns: turns.length, skipped });
}
