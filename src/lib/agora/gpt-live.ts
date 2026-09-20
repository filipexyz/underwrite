/**
 * Shared Agora Conversational AI primitives — RTC+RTM token minting and GPT Live agent lifecycle.
 *
 * Extracted from `lib/interviews/agora.ts` so that more than one surface can run a voice agent
 * (the interview pool, and the signed-in task composer) without either feature importing the other.
 * Nothing here knows what the agent is *for*: the prompt and greeting are supplied by the caller,
 * which is the only thing that differs between the two.
 *
 * Follows the openai-gpt-live-nextjs recipe (agora-agents ≥ 2.8.0, OpenAIGPTLive).
 */
import { RtcRole, RtcTokenBuilder } from "agora-token";
import type { AgentSession } from "agora-agents";
import type { McpServersItem } from "agora-agents";
import { env } from "@/lib/env";

const TOKEN_TTL_SECONDS = 3600;

const globalForSessions = globalThis as typeof globalThis & {
  __underwriteAgoraAgentSessions?: Map<string, AgentSession>;
};

/**
 * Retain live agent sessions so a later stop can call `session.stop()`.
 *
 * Keyed by `agentId` on a process-global map, which means it only survives within one server instance
 * — `stopGptLiveAgent` therefore falls back to the stateless `client.stopAgent(agentId)` when the map
 * misses (cold start, another lambda). The fallback is the path production actually uses.
 */
function sessionMap(): Map<string, AgentSession> {
  globalForSessions.__underwriteAgoraAgentSessions ??= new Map();
  return globalForSessions.__underwriteAgoraAgentSessions;
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

/** Build an RTC+RTM publisher token for a channel. Throws when Agora is not configured. */
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

export function newChannelName(prefix: string, ...parts: string[]): string {
  const safe = `${prefix}-${parts.join("-")}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return `uw-${safe}`;
}

export type StartGptLiveAgentArgs = {
  channel: string;
  userUid: string;
  /** System prompt for the agent. Owned by the caller — this module has no opinion. */
  prompt: string;
  /** First thing the agent says, so the human is not met with silence. */
  greeting: string;
  /** Distinct uid per surface, so two agents never collide if channels ever overlap. */
  agentUid: string;
  /**
   * MCP servers the agent may call tools from. When set, `withTools(true)` is enabled — the SDK documents
   * the pair as required together — and Agora's engine acts as the MCP client against our server
   * (`initialize` -> `tools/list` -> `tools/call`), feeding the result back into the model's context.
   *
   * `McpServersItem` is `Record<string, unknown>` in the SDK, so the entry shape comes from Agora's own
   * sample: `{ name, endpoint, transport: "streamable_http", headers, allowed_tools }`.
   */
  mcpServers?: McpServersItem[];
};

/**
 * Start a GPT Live agent.
 *
 * Note on failure modes: `session.start()` resolves as soon as the agent session is *accepted*, so a
 * later provider rejection (an invalid model, key or request) does not throw here — the agent simply
 * never joins the channel. That is why callers must not treat a resolved start as "the agent is live":
 * the browser sees `remotes 0` and the only evidence is an RTM error message.
 */
export async function startGptLiveAgent(args: StartGptLiveAgentArgs): Promise<{ agentId: string; agentUid: string }> {
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

  const agentUid = args.agentUid;
  // `withTools` returns a new agent, so the builder result has to be reassigned.
  let agent = new Agent({
    client,
    advancedFeatures: { enable_rtm: true, enable_tools: false },
    parameters: {
      /*
       * `audio_scenario: "chorus"` is REQUIRED in this configuration. It looks like leftover karaoke
       * tuning and I removed it as "the one non-standard parameter" — and the agent then joined the
       * channel and was torn down after 2 seconds, where before it held a real conversation.
       * The Agora call detail for that run is the evidence: agent uid 123457 in at 02:39:06, out at
       * 02:39:08, peak concurrent users 1 — it never met the browser.
       *
       * Do not remove it again without a passing call on the other side of the change.
       */
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
      prompt: args.prompt,
      greeting: args.greeting,
      ...(args.mcpServers?.length ? { mcpServers: args.mcpServers } : {}),
    }),
  );
  if (args.mcpServers?.length) agent = agent.withTools(true);

  const session = agent.createSession({
    name: `agent-${args.channel}`.slice(0, 64),
    channel: args.channel,
    agentUid,
    remoteUids: [args.userUid],
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
