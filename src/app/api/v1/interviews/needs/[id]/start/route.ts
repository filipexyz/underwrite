/**
 * POST /api/v1/interviews/needs/[id]/start
 *
 * Mints an RTC+RTM token, starts an OpenAI GPT Live agent from the need brief,
 * and returns channel + token + uid for the browser Agora client.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { mintJoinToken, newBrowserUid, newChannelName, startGptLiveAgent, stopGptLiveAgent } from "@/lib/interviews/agora";
import { agoraUnavailable, requireInterviewUser } from "@/lib/interviews/auth";
import { attachAgentId, getNeed, insertLiveSession, listSessionsForNeed, markSessionFailed } from "@/lib/interviews/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;
  if (!env.agora.enabled) return agoraUnavailable();

  const { id } = await params;
  const { db } = await getDb();
  const need = await getNeed(db, id);
  if (!need) return jsonError(404, `need not found: ${id}`);
  if (need.status === "completed" || need.status === "cancelled") {
    return jsonError(409, `need is ${need.status} and cannot be started`);
  }

  const previous = await listSessionsForNeed(db, need.id);
  for (const session of previous.filter((s) => s.status === "live" && s.agoraAgentId)) {
    try {
      await stopGptLiveAgent(session.agoraAgentId);
    } catch (error) {
      console.warn("[interviews] failed to stop previous agent", error);
    }
    await markSessionFailed(db, session.id, need.id, false);
  }

  const uid = newBrowserUid();
  const sessionId = newId("sess");
  const channel = newChannelName(need.id, sessionId);
  const session = await insertLiveSession(db, need, channel, sessionId);
  const { token, expireAt } = mintJoinToken(channel, uid);

  try {
    const started = await startGptLiveAgent({
      channel,
      userUid: uid.toString(),
      brief: need.brief,
    });
    await attachAgentId(db, session.id, started.agentId);
    return NextResponse.json({
      session_id: session.id,
      need_id: need.id,
      channel,
      token,
      uid: uid.toString(),
      agent_uid: started.agentUid,
      app_id: env.agora.appId,
      agora_agent_id: started.agentId,
      expire_at: expireAt,
    });
  } catch (error) {
    await markSessionFailed(db, session.id, need.id, need.status === "open");
    const message = error instanceof Error ? error.message : "failed to start GPT Live agent";
    console.error("[interviews] start agent failed:", error);
    return jsonError(502, "failed to start GPT Live agent", message);
  }
}
