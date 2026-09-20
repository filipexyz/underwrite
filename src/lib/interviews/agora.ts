/**
 * Interview-pool Agora bindings.
 *
 * The primitives now live in `@/lib/agora/gpt-live` so the signed-in task composer can run a voice
 * agent without importing anything from the interview feature. This module keeps the interview's own
 * exports and binds its prompt, greeting and agent uid, so no interview call site had to change.
 */
import { env } from "@/lib/env";
import {
  mintJoinToken,
  newBrowserUid,
  newChannelName as sharedChannelName,
  startGptLiveAgent as startSharedAgent,
  stopGptLiveAgent,
} from "@/lib/agora/gpt-live";
import { buildInterviewGreeting, buildInterviewPrompt } from "./prompt";
import { DEFAULT_AGENT_UID } from "./types";
import type { InterviewBrief } from "./types";

export { mintJoinToken, newBrowserUid, stopGptLiveAgent };

export function newChannelName(needId: string, sessionId: string): string {
  return sharedChannelName("interview", needId, sessionId);
}

export async function startGptLiveAgent(opts: {
  channel: string;
  userUid: string;
  brief: InterviewBrief;
}): Promise<{ agentId: string; agentUid: string }> {
  if (!env.agora.enabled) throw new Error("Agora / GPT Live is not configured");
  return startSharedAgent({
    channel: opts.channel,
    userUid: opts.userUid,
    prompt: buildInterviewPrompt(opts.brief),
    greeting: buildInterviewGreeting(opts.brief),
    agentUid: String(DEFAULT_AGENT_UID),
  });
}
