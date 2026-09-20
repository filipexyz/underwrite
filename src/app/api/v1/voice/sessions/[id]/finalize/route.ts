/**
 * POST /api/v1/voice/sessions/[id]/finalize — the agent declares the brief complete.
 *
 * Files the marketplace task and **starts the real push job** (Top-K discovery for
 * the classified specialty — same path as hosted agent test / `execution_mode: "push"`).
 * The seed Mastra PDF loop is not used.
 *
 * The job starts in `after()` so the response is not held open by discovery or
 * webhooks — the client needs to answer quickly to keep the voice call responsive.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { finalizeVoiceSession } from "@/lib/voice/flow";
import { scheduleVoicePushJob } from "@/lib/voice/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }

  const { id } = await params;
  const { db } = await getDb();
  const result = await finalizeVoiceSession(db, { sessionId: id, userId: auth.identity.userId, input });
  if (!result.ok) return jsonError(result.status, result.error, result.details);

  if (result.payload.created) {
    scheduleVoicePushJob(result.payload.request_id);
  }

  return NextResponse.json(result.payload, { status: result.payload.created ? 201 : 200 });
}
