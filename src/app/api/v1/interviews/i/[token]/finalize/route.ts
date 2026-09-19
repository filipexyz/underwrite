/**
 * POST /api/v1/interviews/i/[token]/finalize — agent-only completion.
 * Auth = invite token. Rejects (409) if required brief fields are incomplete.
 * Humans have no Finish control; this is called after the agent emits completion JSON
 * or a server-side extract confirms every required field.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { stopGptLiveAgent } from "@/lib/interviews/agora";
import { agoraPublicStatus } from "@/lib/interviews/auth";
import {
  finalizeSession,
  getNeedByToken,
  getSession,
  isIncompleteInterviewError,
  listSessionsForNeed,
} from "@/lib/interviews/store";
import { FinalizeSessionInput } from "@/lib/interviews/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
  const need = await getNeedByToken(db, token);
  if (!need) return jsonError(404, "interview link not found");
  if (need.status === "completed" || need.status === "cancelled") {
    return jsonError(410, "this interview is already finished");
  }

  const sessions = await listSessionsForNeed(db, need.id);
  const session =
    (need.assignedSessionId ? await getSession(db, need.assignedSessionId) : undefined) ??
    sessions.find((s) => s.status === "live") ??
    sessions[0];
  if (!session) return jsonError(409, "no session to finalize — start the interview first");

  try {
    const result = await finalizeSession(db, session, parsed.data);
    try {
      await stopGptLiveAgent(session.agoraAgentId);
    } catch (error) {
      console.warn("[interviews] stop agent failed (answers already persisted):", error);
    }
    return NextResponse.json({
      agora: agoraPublicStatus(),
      completed: true,
      answers_present: Boolean(result.answers),
    });
  } catch (error) {
    if (isIncompleteInterviewError(error)) {
      return jsonError(409, error.message, { missing: error.missing });
    }
    throw error;
  }
}
