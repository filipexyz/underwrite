/**
 * Agora GPT Live helpers — token mint, agent start/stop.
 * Follows the openai-gpt-live-nextjs recipe (agora-agents ≥ 2.8.0, OpenAIGPTLive).
 */
import { RtcRole, RtcTokenBuilder } from "agora-token";
import type { AgentSession } from "agora-agents";
import { env } from "@/lib/env";
import { buildInterviewGreeting, buildInterviewPrompt } from "./prompt";
import { DEFAULT_AGENT_UID } from "./types";
import type { InterviewBrief } from "./types";

const TOKEN_TTL_SECONDS = 3600;

const globalForSessions = globalThis as typeof globalThis & {
  __underwriteInterviewSessions?: Map<string, AgentSession>;
};

function sessionMap(): Map<string, AgentSession> {
  globalForSessions.__underwriteInterviewSessions ??= new Map();
  return globalForSessions.__underwriteInterviewSessions;
}

export function storeAgentSession(agentId: string, session: AgentSession): void {
  sessionMap().set(agentId, session);
}

export function takeAgentSession(agentId: string): AgentSession | undefined {
  const session = sessionMap().get(agentId);
  sessionMap().delete(agentId);
  return session;
}

function agoraArea() {
  // Lazy import so tests that never start an agent don't need the native path.
  return import("agora-agents").then(({ Area }) => {
    switch (env.agora.area) {
      case "EU":
        return Area.EU;
      case "AP":
        return Area.AP;
      case "CN":
        return Area.CN;
      default:
        return Area.US;
    }
  });
}

export function mintJoinToken(channel: string, uid: number): { token: string; expireAt: number } {
  const appId = env.agora.appId;
  const certificate = env.agora.certificate;
  if (!appId || !certificate) {
    throw new Error("Agora credentials are not set");
  }
  const expireAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = RtcTokenBuilder.buildTokenWithRtm(
    appId,
    certificate,
    channel,
    uid.toString(),
    RtcRole.PUBLISHER,
    expireAt,
    expireAt,
  );
  return { token, expireAt };
}

export function newBrowserUid(): number {
  return Math.floor(Math.random() * 9_999_000) + 1000;
}

export function newChannelName(needId: string, sessionId: string): string {
  const safe = `${needId}-${sessionId}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return `interview-${safe}`;
}

export async function startGptLiveAgent(opts: {
  channel: string;
  userUid: string;
  brief: InterviewBrief;
}): Promise<{ agentId: string; agentUid: string }> {
  const { AgoraClient, Agent, ExpiresIn, OpenAIGPTLive } = await import("agora-agents");
  const appId = env.agora.appId;
  const certificate = env.agora.certificate;
  const apiKey = env.agora.openaiKey;
  if (!appId || !certificate || !apiKey) {
    throw new Error("Agora / GPT Live is not configured");
  }

  const client = new AgoraClient({
    area: await agoraArea(),
    appId,
    appCertificate: certificate,
  });

  const agentUid = String(DEFAULT_AGENT_UID);
  const agent = new Agent({
    client,
    advancedFeatures: { enable_rtm: true, enable_tools: false },
    parameters: {
      audio_scenario: "chorus",
      data_channel: "rtm",
      enable_error_message: true,
      enable_metrics: true,
    },
  }).withMllm(
    new OpenAIGPTLive({
      apiKey,
      model: env.agora.model,
      voice: env.agora.voice,
      prompt: buildInterviewPrompt(opts.brief),
      greeting: buildInterviewGreeting(opts.brief),
    }),
  );

  const session = agent.createSession({
    name: `interview-${opts.channel}`.slice(0, 64),
    channel: opts.channel,
    agentUid,
    remoteUids: [opts.userUid],
    idleTimeout: 180,
    expiresIn: ExpiresIn.hours(1),
  });

  const agentId = await session.start();
  storeAgentSession(agentId, session);
  return { agentId, agentUid };
}

export async function stopGptLiveAgent(agentId: string | null | undefined): Promise<void> {
  if (!agentId) return;
  const retained = takeAgentSession(agentId);
  if (retained) {
    await retained.stop();
    return;
  }
  if (!env.agora.enabled) return;
  const { AgoraClient } = await import("agora-agents");
  const client = new AgoraClient({
    area: await agoraArea(),
    appId: env.agora.appId as string,
    appCertificate: env.agora.certificate as string,
  });
  await client.stopAgent(agentId);
}
