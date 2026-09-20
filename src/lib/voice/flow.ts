/**
 * Voice task composer — the conversation lifecycle.
 *
 * Mirrors the shape of the interview flow (for consistency and because that shape is proven), but the
 * state it manages is its own: a signed-in user talking to an agent until there is a task, with no
 * need, no invite token, and no second human.
 */
import type { Db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { mintJoinToken, newBrowserUid, newChannelName, startGptLiveAgent, stopGptLiveAgent } from "@/lib/agora/gpt-live";
import { createTaskFromVoiceBrief } from "./handoff";
import { extractBriefFromTranscript } from "./extract";
import { buildVoiceComposerGreeting, buildVoiceComposerPrompt, summarizeBrief } from "./prompt";
import {
  MAX_VOICE_TRANSCRIPT_TURNS_PER_WRITE,
  appendVoiceTranscript,
  attachVoiceAgentId,
  cancelVoiceSessionsForUser,
  completeVoiceSession,
  failVoiceSession,
  getVoiceSession,
  insertVoiceSession,
  replaceVoiceSession,
} from "./store";
import { DEFAULT_VOICE_CATEGORY, VOICE_AGENT_UID, VoiceFinalizeInput, type VoiceTaskBrief } from "./types";

export type StartVoiceResult =
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
        /** Prompt preview is never returned; the greeting is, so the UI can show what to expect. */
        greeting: string;
      };
    }
  | { ok: false; status: number; error: string; details?: unknown };

export async function startVoiceSession(db: Db, userId: string): Promise<StartVoiceResult> {
  if (!env.agora.enabled) {
    return {
      ok: false,
      status: 503,
      error: "Voice composer is disabled: Agora / GPT Live is not configured.",
      details: { missing: env.agora.missing },
    };
  }

  // One live conversation per user. A tab that was closed without finalizing would otherwise leave an
  // agent running and billing, and the next start would open a second one.
  for (const stale of await cancelVoiceSessionsForUser(db, userId)) {
    if (stale.agoraAgentId) {
      try {
        await stopGptLiveAgent(stale.agoraAgentId);
      } catch (error) {
        console.warn("[voice] failed to stop previous agent", error);
      }
    }
    await replaceVoiceSession(db, stale.id);
  }

  const uid = newBrowserUid();
  const session = await insertVoiceSession(db, {
    userId,
    channel: newChannelName("voice", sessionIdForChannel(userId)),
  });
  const { token, expireAt } = mintJoinToken(session.agoraChannel, uid);

  try {
    const started = await startGptLiveAgent({
      channel: session.agoraChannel,
      userUid: uid.toString(),
      prompt: buildVoiceComposerPrompt(),
      greeting: buildVoiceComposerGreeting(),
      agentUid: String(VOICE_AGENT_UID),
    });
    await attachVoiceAgentId(db, session.id, started.agentId);
    return {
      ok: true,
      payload: {
        session_id: session.id,
        channel: session.agoraChannel,
        token,
        uid: uid.toString(),
        agent_uid: started.agentUid,
        app_id: env.agora.appId,
        agora_agent_id: started.agentId,
        expire_at: expireAt,
        greeting: buildVoiceComposerGreeting(),
      },
    };
  } catch (error) {
    await failVoiceSession(db, session.id, {
      error: error instanceof Error ? error.message : "failed to start GPT Live agent",
    });
    console.error("[voice] start agent failed:", error);
    return {
      ok: false,
      status: 502,
      error: "failed to start the voice agent",
      details: error instanceof Error ? error.message : undefined,
    };
  }
}

/** Channel names must be unique per session; the session id is what makes them so. */
function sessionIdForChannel(userId: string): string {
  return `${userId}-${Date.now().toString(36)}`;
}

/**
 * File the task for an already-validated brief, once.
 *
 * Shared by the two ways a conversation can end: the tool call (the agent submits typed arguments) and
 * the fallback path (the server extracts the brief from the transcript). Both must produce exactly one
 * task per conversation, so the idempotency lives here rather than in either caller.
 */
export async function submitVoiceBrief(
  db: Db,
  args: { session: { id: string; agoraAgentId: string | null; requestId: string | null }; brief: VoiceTaskBrief; transcript?: unknown },
): Promise<{ requestId: string; created: boolean; summary: string }> {
  const task = await createTaskFromVoiceBrief(db, {
    // `createTaskFromVoiceBrief` only reads `id` and `userId` off the row; the narrow shape keeps this
    // callable from a tool route that has not loaded the full session.
    session: args.session as never,
    brief: args.brief,
  });
  await completeVoiceSession(db, args.session.id, { brief: args.brief, requestId: task.requestId });
  try {
    await stopGptLiveAgent(args.session.agoraAgentId);
  } catch (error) {
    // The task exists; a stuck agent must not fail the submission.
    console.warn("[voice] stop agent failed (task already created):", error);
  }
  return { requestId: task.requestId, created: task.created, summary: summarizeBrief(args.brief) };
}

export type FinalizeVoiceResult =
  | { ok: true; payload: { session_id: string; request_id: string; created: boolean; summary: string; category: string } }
  | { ok: false; status: number; error: string; details?: unknown };

/**
 * Accept the agent's brief, file the task, and stop the agent.
 *
 * The brief is re-validated here rather than trusted from the client: the browser is the one that
 * parsed the agent's JSON, and a malformed or out-of-range brief must not become a marketplace task.
 */
export async function finalizeVoiceSession(
  db: Db,
  args: { sessionId: string; userId: string; input: unknown },
): Promise<FinalizeVoiceResult> {
  const session = await getVoiceSession(db, args.sessionId, args.userId);
  if (!session) return { ok: false, status: 404, error: "session not found" };
  if (session.status === "completed" && session.requestId) {
    return {
      ok: true,
      payload: {
        session_id: session.id,
        request_id: session.requestId,
        created: false,
        summary: session.briefJson ? summarizeBrief(session.briefJson) : "",
        category: session.briefJson?.category ?? DEFAULT_VOICE_CATEGORY,
      },
    };
  }
  if (session.status !== "live") return { ok: false, status: 409, error: `session is ${session.status}` };

  const parsed = VoiceFinalizeInput.safeParse(args.input);
  if (!parsed.success) {
    return { ok: false, status: 422, error: "transcript is required to file the task", details: parsed.error.flatten() };
  }

  const transcript = parsed.data.transcript_json;
  await appendVoiceTranscript(db, session.id, transcript.slice(-MAX_VOICE_TRANSCRIPT_TURNS_PER_WRITE));

  /*
   * The brief comes from the transcript, not from the agent speaking it. TTS/ASR mangles dictated JSON,
   * so the structure is recovered in text where it can be validated and retried — the same pattern
   * `finalizeSession` uses for interviews. A client-supplied brief (when the agent's closing text
   * happened to parse) is used as-is, because it costs nothing and skips an inference call.
   */
  const brief = parsed.data.brief ?? (await extractBriefFromTranscript(transcript));
  if (!brief) {
    return {
      ok: false,
      status: 409,
      error: "could not read a complete brief from the conversation — the agent still needs the deliverable and the terms",
    };
  }

  const submitted = await submitVoiceBrief(db, { session, brief });
  return {
    ok: true,
    payload: {
      session_id: session.id,
      request_id: submitted.requestId,
      created: submitted.created,
      summary: submitted.summary,
      category: brief.category ?? DEFAULT_VOICE_CATEGORY,
    },
  };
}
