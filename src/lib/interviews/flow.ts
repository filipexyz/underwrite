import type { Db } from "@/lib/db/client";
import type { InterviewNeedRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { mintJoinToken, newBrowserUid, newChannelName, startGptLiveAgent, stopGptLiveAgent } from "./agora";
import { attachAgentId, insertLiveSession, listSessionsForNeed, markSessionFailed } from "./store";

export type StartInterviewResult =
  | {
      ok: true;
      payload: {
        session_id: string;
        channel: string;
        token: string;
        uid: string;
        agent_uid: string;
        app_id: string | undefined;
        agora_agent_id: string;
        expire_at: number;
      };
    }
  | { ok: false; status: number; error: string; details?: unknown };

export async function startInterviewForNeed(db: Db, need: InterviewNeedRow): Promise<StartInterviewResult> {
  if (need.status === "completed" || need.status === "cancelled") {
    return { ok: false, status: 410, error: `this interview is ${need.status}` };
  }
  if (!env.agora.enabled) {
    return { ok: false, status: 503, error: "Interview pool is disabled: Agora / GPT Live is not configured.", details: { missing: env.agora.missing } };
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
    return {
      ok: true,
      payload: {
        session_id: session.id,
        channel,
        token,
        uid: uid.toString(),
        agent_uid: started.agentUid,
        app_id: env.agora.appId,
        agora_agent_id: started.agentId,
        expire_at: expireAt,
      },
    };
  } catch (error) {
    await markSessionFailed(db, session.id, need.id, need.status === "open");
    const message = error instanceof Error ? error.message : "failed to start GPT Live agent";
    console.error("[interviews] start agent failed:", error);
    return { ok: false, status: 502, error: "failed to start GPT Live agent", details: message };
  }
}
