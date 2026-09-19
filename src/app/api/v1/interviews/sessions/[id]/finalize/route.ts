/**
 * POST /api/v1/interviews/sessions/[id]/finalize
 *
 * Creator path. Same completeness rule as the public token: reject (409) if the
 * brief is incomplete. Stops the GPT Live agent only after answers cover every
 * required field (agent JSON, client payload, or post-call LLM extract).
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { stopGptLiveAgent } from "@/lib/interviews/agora";
import { agoraPublicStatus, requireInterviewUser } from "@/lib/interviews/auth";
import { finalizeSession, getSession, isIncompleteInterviewError, toApiNeed, toApiSession } from "@/lib/interviews/store";
import { FinalizeSessionInput } from "@/lib/interviews/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;

  const { id } = await params;
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = FinalizeSessionInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid finalize payload", parsed.error.flatten());

  const { db } = await getDb();
  const session = await getSession(db, id);
  if (!session) return jsonError(404, `session not found: ${id}`);
  if (session.status === "completed") {
    return jsonError(409, "session already finalized");
  }

  try {
    const result = await finalizeSession(db, session, parsed.data);
    try {
      await stopGptLiveAgent(session.agoraAgentId);
    } catch (error) {
      console.warn("[interviews] stop agent failed (answers already persisted):", error);
    }
    return NextResponse.json({
      agora: agoraPublicStatus(),
      session: toApiSession(result.session),
      need: toApiNeed(result.need),
      answers: result.answers,
    });
  } catch (error) {
    if (isIncompleteInterviewError(error)) {
      return jsonError(409, error.message, { missing: error.missing });
    }
    throw error;
  }
}
