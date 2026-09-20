/**
 * POST /api/v1/voice/sessions/[id]/submit — the agent's **end tool**.
 *
 * This is the endpoint an Agora tool call targets. The agent decides the conversation is over and calls
 * `submit` with typed arguments, and those exact values become the task — no dictated JSON, no phrase
 * matching, no timer deciding on the agent's behalf.
 *
 * It is signed-in and owner-scoped like every other route on this surface, so the endpoint can be exposed
 * to the agent without becoming an open write. The body is the tool's argument schema and is validated
 * here, because the browser (or the agent) is not a trustworthy source of marketplace terms.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getVoiceSession } from "@/lib/voice/store";
import { submitVoiceBrief } from "@/lib/voice/flow";
import { DEFAULT_VOICE_CATEGORY, VoiceTaskBrief } from "@/lib/voice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = VoiceTaskBrief.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid brief", parsed.error.flatten());

  const { id } = await params;
  const { db } = await getDb();
  const session = await getVoiceSession(db, id, auth.identity.userId);
  if (!session) return jsonError(404, "session not found");
  if (session.status === "completed" && session.requestId) {
    // Idempotent: a retried tool call must not post a second task.
    return NextResponse.json({
      session_id: session.id,
      request_id: session.requestId,
      created: false,
      category: session.briefJson?.category ?? DEFAULT_VOICE_CATEGORY,
    });
  }
  if (session.status !== "live") return jsonError(409, `session is ${session.status}`);

  const submitted = await submitVoiceBrief(db, { session, brief: parsed.data });
  return NextResponse.json(
    {
      session_id: session.id,
      request_id: submitted.requestId,
      created: submitted.created,
      summary: submitted.summary,
      category: parsed.data.category ?? DEFAULT_VOICE_CATEGORY,
    },
    { status: submitted.created ? 201 : 200 },
  );
}
