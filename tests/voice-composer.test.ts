/**
 * Voice task composer — the signed-in entry point.
 *
 * Covers the two things that make this surface different from the interview pool: the brief is the
 * *contract* (so composition must be deterministic and echo every agreed term), and the task is filed
 * automatically (so idempotency matters — one conversation must never produce two charged tasks).
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as finalizeRoute } from "@/app/api/v1/voice/sessions/[id]/finalize/route";
import { POST as mcpVoice } from "@/app/api/mcp/voice/[sessionId]/route";
import { GET as sessionRoute } from "@/app/api/v1/voice/sessions/[id]/route";
import { POST as transcriptRoute } from "@/app/api/v1/voice/sessions/[id]/transcript/route";
import { getDb } from "@/lib/db/client";
import { LOCAL_DEV_USER_ID } from "@/lib/auth/session";
import { listEvents } from "@/lib/ledger/ledger";
import { ensureUserWallet } from "@/lib/marketplace/credits";
import { getRequest } from "@/lib/marketplace/requests";
import { registerSellerAgent } from "@/lib/marketplace/sellers";
import { extractBriefJson } from "@/app/start/voice-composer";
import { composeVoiceRequirement, createTaskFromVoiceBrief, voiceBriefToRequestInput } from "@/lib/voice/handoff";
import { flushScheduledVoicePushJobs } from "@/lib/voice/push";
import {
  appendVoiceTranscript,
  completeVoiceSession,
  failVoiceSession,
  getVoiceSession,
  insertVoiceSession,
  listVoiceSessions,
} from "@/lib/voice/store";
import { VoiceTaskBrief } from "@/lib/voice/types";
import { extractLastJsonObject, transcriptToPrompt } from "@/lib/voice/extract";
import { buildVoiceComposerGreeting, buildVoiceComposerPrompt, summarizeBrief } from "@/lib/voice/prompt";

/** The routes authenticate through `requireSignedInApi`, which is `local-dev` when Auth0 is off. */
const USER = LOCAL_DEV_USER_ID;

const brief: VoiceTaskBrief = {
  requirement: "Produce a one-page launch brief for the agent marketplace",
  max_cost_usd: 0.35,
  max_latency_s: 75,
  min_confidence: 0.92,
  failure_policy: "refund",
  category: "html_to_pdf",
  notes: "Wants it before the demoday",
};

function jsonRequest(body: unknown, method = "POST") {
  return new Request("http://localhost:3000/api/v1/voice/sessions", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  const handle = await getDb();
  await handle.migrate();
});

describe("brief extraction from the agent's last turn", () => {
  it("pulls the JSON out of a spoken turn, ignoring trailing speech", () => {
    const parsed = extractBriefJson(
      'All set. {"requirement":"ship a brief","max_cost_usd":0.2,"max_latency_s":60,"min_confidence":0.9,"failure_policy":"refund"} thanks!',
    );
    expect(VoiceTaskBrief.safeParse(parsed).success).toBe(true);
  });

  it("returns null rather than throwing on a half-spoken object", () => {
    expect(extractBriefJson("no json here")).toBeNull();
    expect(extractBriefJson("{ not: valid }")).toBeNull();
  });

  it("rejects a brief outside the marketplace's range", () => {
    const bad = { ...brief, min_confidence: 1.4 };
    expect(VoiceTaskBrief.safeParse(bad).success).toBe(false);
  });
});

describe("brief extraction from the transcript", () => {
  it("reads the last JSON object out of a model reply with trailing prose", () => {
    const parsed = extractLastJsonObject(
      'Here you go: {"requirement":"a brief","max_cost_usd":0.2,"max_latency_s":60,"min_confidence":0.9,"failure_policy":"refund"} hope that helps',
    );
    expect(VoiceTaskBrief.safeParse(parsed).success).toBe(true);
  });

  it("returns null on an unparseable reply instead of throwing", () => {
    expect(extractLastJsonObject("no json")).toBeNull();
    expect(extractLastJsonObject("{ nope }")).toBeNull();
  });

  it("renders the transcript for the extractor and keeps the most recent part", () => {
    const turns = [
      { role: "assistant" as const, text: "What should be delivered?" },
      { role: "user" as const, text: "A one-page brief" },
    ];
    const rendered = transcriptToPrompt(turns);
    expect(rendered).toContain("AGENT: What should be delivered?");
    expect(rendered).toContain("HUMAN: A one-page brief");
    // Long calls must not produce an unbounded prompt: the tail is what carries the agreement.
    const long = transcriptToPrompt([{ role: "user", text: "x".repeat(9_000) }]);
    expect(long.length).toBeLessThanOrEqual(8_000);
  });
});

describe("prompt guidance", () => {
  it("tells the agent the terms, the order, and that it must push back", () => {
    const prompt = buildVoiceComposerPrompt();
    expect(prompt).toContain("maximum price");
    expect(prompt).toContain("minimum confidence");
    // The guiding behaviour is the feature — assert it is actually instructed, not implied.
    expect(prompt.toLowerCase()).toContain("push back");
    expect(prompt).toContain("empty market");
  });

  it("tells the agent to submit through the tool, and to claim nothing it cannot know", () => {
    const prompt = buildVoiceComposerPrompt();
    // The tool is the mechanism now: no spoken JSON, no closing phrase, no timer.
    expect(prompt).toContain("submit_task");
    expect(prompt).toContain("only way a task is created");
    // And the dishonest sentence from the last live transcript must be explicitly forbidden.
    expect(prompt).toContain("never say a task was posted unless the tool");
  });

  it("greets with the first question instead of silence", () => {
    expect(buildVoiceComposerGreeting()).toContain("delivered");
  });

  it("reads the agreed terms back in one line", () => {
    const summary = summarizeBrief(brief);
    expect(summary).toContain("$0.35");
    expect(summary).toContain("75 seconds");
    expect(summary).toContain("92%");
  });
});

describe("requirement composition", () => {
  it("states the requirement first and echoes every agreed term", () => {
    const text = composeVoiceRequirement(brief);
    expect(text.startsWith(brief.requirement)).toBe(true);
    expect(text).toContain("$0.35");
    expect(text).toContain("75 seconds");
    expect(text).toContain("92%");
    expect(text).toContain("refund");
    expect(text).toContain("Wants it before the demoday");
  });

  it("bounds the requirement", () => {
    const text = composeVoiceRequirement({ ...brief, requirement: "x".repeat(20_000) });
    expect(text.length).toBeLessThanOrEqual(4_000);
  });

  it("maps the brief onto the 4+1 request fields", () => {
    const input = voiceBriefToRequestInput(brief);
    expect(input.max_cost_usd).toBe(0.35);
    expect(input.max_latency_s).toBe(75);
    expect(input.min_confidence).toBe(0.92);
    expect(input.failure_policy).toBe("refund");
    expect(input.category).toBe("html_to_pdf");
    expect(input.task.files).toEqual([]);
    expect(input.execution_mode).toBe("push");
    expect(input.invite_agent_ids).toBeUndefined();
  });
});

describe("task handoff", () => {
  it("files once, attributed to the agent, and is idempotent on retry", async () => {
    const classify = await import("@/lib/typesafe/classify");
    const classifySpy = vi.spyOn(classify, "classifyTask");
    const { db } = await getDb();
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-test-1" });

    const first = await createTaskFromVoiceBrief(db, { session, brief });
    expect(first.created).toBe(true);
    expect(classifySpy).toHaveBeenCalled();
    classifySpy.mockRestore();

    const request = await getRequest(db, first.requestId);
    expect(request?.requirement).toContain("launch brief");
    expect(request?.maxCostUsd).toBe(0.35);
    expect(request?.buyerWalletId).toBe(USER);
    expect(request?.executionMode).toBe("push");
    expect(request?.state?.requested_invite_agent_ids ?? []).toEqual([]);

    const events = await listEvents(db, first.requestId);
    const received = events.find((e) => e.type === "request_received");
    expect(received?.payload.actor).toBe("agent");
    expect(received?.payload.source).toBe("voice-composer");

    await completeVoiceSession(db, session.id, { brief, requestId: first.requestId });
    const second = await createTaskFromVoiceBrief(db, { session, brief });
    expect(second.created).toBe(false);
    expect(second.requestId).toBe(first.requestId);
  });

  it("does not file a second task when the same conversation finalizes twice", async () => {
    const { db } = await getDb();
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-test-2" });
    const first = await createTaskFromVoiceBrief(db, { session, brief });
    await completeVoiceSession(db, session.id, { brief, requestId: first.requestId });

    const again = await finalizeRoute(
      jsonRequest({ brief }) as never,
      { params: Promise.resolve({ id: session.id }) },
    );
    // 200, not 201: nothing new was created.
    expect([200, 201]).toContain(again.status);
    const body = (await again.json()) as { request_id: string; created: boolean };
    expect(body.request_id).toBe(first.requestId);
    expect(body.created).toBe(false);
  });
});

describe("session store", () => {
  it("scopes reads to the owning user", async () => {
    const { db } = await getDb();
    const mine = await insertVoiceSession(db, { userId: USER, channel: "voice-test-3" });
    expect(await getVoiceSession(db, mine.id, USER)).toBeTruthy();
    expect(await getVoiceSession(db, mine.id, "auth0|someone-else")).toBeUndefined();
    expect((await listVoiceSessions(db, "auth0|someone-else")).some((r) => r.id === mine.id)).toBe(false);
  });

  it("merges transcript turns by id and refuses to append to a finished session", async () => {
    const { db } = await getDb();
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-test-4" });

    await appendVoiceTranscript(db, session.id, [{ role: "assistant", text: "Hello", turn_id: 1 }]);
    const grown = await appendVoiceTranscript(db, session.id, [{ role: "assistant", text: "Hello there", turn_id: 1 }]);
    expect(grown.turns.filter((t) => t.turn_id === 1)).toHaveLength(1);
    expect(grown.turns[0]?.text).toBe("Hello there");

    await failVoiceSession(db, session.id, { error: "superseded" });
    const afterFail = await appendVoiceTranscript(db, session.id, [{ role: "assistant", text: "late" }]);
    expect(afterFail.skipped).toBe(1);
    expect(afterFail.turns.some((t) => t.text === "late")).toBe(false);
  });
});

describe("routes", () => {
  it("404s an unknown session and 409s a finished one for the transcript route", async () => {
    const { db } = await getDb();
    const missing = await transcriptRoute(jsonRequest({ transcript_json: [{ role: "assistant", text: "hi" }] }) as never, {
      params: Promise.resolve({ id: "voice_missing" }),
    });
    expect(missing.status).toBe(404);

    const done = await insertVoiceSession(db, { userId: USER, channel: "voice-test-5" });
    await failVoiceSession(db, done.id, { error: "superseded" });
    const conflict = await transcriptRoute(
      jsonRequest({ transcript_json: [{ role: "assistant", text: "hi" }] }) as never,
      { params: Promise.resolve({ id: done.id }) },
    );
    expect(conflict.status).toBe(409);
  });

  it("rejects an oversized append before it reaches the database", async () => {
    const { db } = await getDb();
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-test-6" });
    const res = await transcriptRoute(
      jsonRequest({
        transcript_json: Array.from({ length: 61 }, (_, i) => ({ role: "assistant", text: `t${i}` })),
      }) as never,
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(res.status).toBe(422);
    expect(session.transcriptJson ?? []).toHaveLength(0);
  });

  it("serves the session state with a cursor for live polling", async () => {
    const { db } = await getDb();
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-test-7" });
    await appendVoiceTranscript(db, session.id, [
      { role: "assistant", text: "first", turn_id: 1 },
      { role: "assistant", text: "second", turn_id: 2 },
    ]);

    const res = await sessionRoute(
      new Request("http://localhost:3000/api/v1/voice/sessions/x?after=1"),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; from: number; turns: Array<{ text: string }> };
    expect(body.total).toBe(2);
    expect(body.from).toBe(1);
    expect(body.turns.map((t) => t.text)).toEqual(["second"]);
  });
});

const PINNED_AGENT_ID = "agt_151cf";

function sellerDraft(name: string, specialty: string, webhook?: string) {
  return {
    name,
    role: "executor" as const,
    specialties: [specialty],
    model_family: "family-voice",
    model: "auto",
    baseline_confidence: 0.96,
    cost_ceiling_usd: 0.04,
    latency_class: "fast" as const,
    risk_tolerance: "mid" as const,
    ...(webhook ? { webhook_url: webhook } : { hosted: false as const }),
  };
}

describe("voice finalize starts push, not the seed PDF loop", () => {
  it("does not import runMarketplace or pin a hardcoded agent id", () => {
    const kickoff = [
      "src/app/api/v1/voice/sessions/[id]/finalize/route.ts",
      "src/app/api/mcp/voice/[sessionId]/route.ts",
      "src/app/api/v1/voice/sessions/[id]/tools/submit_task/route.ts",
    ].map((file) => readFileSync(file, "utf8"));
    const helpers = ["src/lib/voice/handoff.ts", "src/lib/voice/push.ts"].map((file) => readFileSync(file, "utf8"));
    for (const source of [...kickoff, ...helpers]) {
      expect(source).not.toMatch(/from\s+["']@\/mastra["']/);
      expect(source).not.toContain(PINNED_AGENT_ID);
      expect(source).not.toMatch(/invite_agent_ids:\s*\[/);
    }
    for (const source of kickoff) {
      expect(source).not.toContain("runMarketplace");
      expect(source).toContain("scheduleVoicePushJob");
    }
  });

  it("finalizes onto a push job and invites Top-K for the category", async () => {
    const marketplace = await import("@/mastra");
    const runSpy = vi.spyOn(marketplace, "runMarketplace");
    const pushMod = await import("@/lib/marketplace/push");
    const startSpy = vi.spyOn(pushMod, "startPushJob");

    const { db } = await getDb();
    await ensureUserWallet(db, USER);
    const specialty = "landing_page";
    const hosted = await registerSellerAgent(
      db,
      "user_voice_push_hosted",
      sellerDraft(
        "Voice hosted landing",
        specialty,
        "https://underwrite-cloudflare-seller.example.workers.dev/webhook/voice-hosted",
      ),
    );
    const inbox = await registerSellerAgent(db, "user_voice_push_inbox", sellerDraft("Voice inbox landing", specialty));

    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-push-1" });
    const res = await finalizeRoute(
      jsonRequest({
        brief: { ...brief, category: specialty, requirement: "Build a one-page landing for the launch" },
        transcript_json: [{ role: "assistant", text: "Posted." }],
      }) as never,
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request_id: string; created: boolean };
    expect(body.created).toBe(true);

    await flushScheduledVoicePushJobs();

    expect(runSpy).not.toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
    expect(startSpy.mock.calls.some((call) => call[1] === body.request_id)).toBe(true);

    const request = await getRequest(db, body.request_id);
    expect(request?.executionMode).toBe("push");
    expect(request?.category).toBe(specialty);
    expect(request?.status).toBe("planning");
    expect(request?.state?.requested_invite_agent_ids ?? []).toEqual([]);
    const invited = request?.state?.invited_agent_ids ?? [];
    expect(invited).toEqual(expect.arrayContaining([hosted.agent.agentId, inbox.agent.agentId]));
    expect(invited).not.toContain(PINNED_AGENT_ID);
    expect(invited).not.toContain("a-delegator");
    expect(invited[0]).toBe(hosted.agent.agentId);

    const events = await listEvents(db, body.request_id);
    expect(events.some((e) => e.type === "plan_request")).toBe(true);
    expect(events.some((e) => e.type === "request_received" && e.payload.execution_mode === "push")).toBe(true);

    runSpy.mockRestore();
    startSpy.mockRestore();
  });

  it("fails loudly when no hireable agent matches the specialty", async () => {
    const marketplace = await import("@/mastra");
    const runSpy = vi.spyOn(marketplace, "runMarketplace");
    const { db } = await getDb();
    await ensureUserWallet(db, USER);
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-push-empty" });
    const res = await finalizeRoute(
      jsonRequest({
        brief: {
          ...brief,
          category: "voice_empty_specialty",
          requirement: "Do a thing no seller is listed for",
        },
        transcript_json: [{ role: "user", text: "please" }],
      }) as never,
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { request_id: string };
    await flushScheduledVoicePushJobs();

    expect(runSpy).not.toHaveBeenCalled();
    const request = await getRequest(db, body.request_id);
    expect(request?.executionMode).toBe("push");
    expect(request?.status).toBe("no_eligible_plan");
    expect(request?.error).toMatch(/no hireable agents/i);
    const outcome = (request?.outcome ?? {}) as { reason?: string };
    expect(outcome.reason).toMatch(/no hireable agents/i);

    const events = await listEvents(db, body.request_id);
    const selected = events.find((e) => e.type === "plan_selected");
    expect(selected?.payload.reason).toMatch(/no hireable agents/i);

    runSpy.mockRestore();
  });

  it("MCP submit_task starts push, not runMarketplace", async () => {
    process.env.AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? "test-voice-mcp-cert";
    const token = process.env.AGORA_APP_CERTIFICATE;
    const marketplace = await import("@/mastra");
    const runSpy = vi.spyOn(marketplace, "runMarketplace");

    const { db } = await getDb();
    await ensureUserWallet(db, USER);
    const specialty = "research_report";
    const seller = await registerSellerAgent(
      db,
      "user_voice_mcp_push",
      sellerDraft(
        "Voice MCP researcher",
        specialty,
        "https://underwrite-cloudflare-seller.example.workers.dev/webhook/voice-mcp",
      ),
    );
    const session = await insertVoiceSession(db, { userId: USER, channel: "voice-mcp-push" });

    const res = await mcpVoice(
      new Request(`http://localhost:3000/api/mcp/voice/${session.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "submit_task",
            arguments: {
              requirement: "Write a research memo on agent marketplaces",
              max_cost_usd: 0.2,
              max_latency_s: 60,
              min_confidence: 0.9,
              failure_policy: "refund",
              category: specialty,
            },
          },
        }),
      }),
      { params: Promise.resolve({ sessionId: session.id }) },
    );
    expect(res.status).toBe(200);
    const rpc = (await res.json()) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    expect(rpc.result?.isError).not.toBe(true);
    const posted = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as { request_id?: string; ok?: boolean };
    expect(posted.ok).toBe(true);
    expect(posted.request_id).toBeTruthy();

    await flushScheduledVoicePushJobs();
    expect(runSpy).not.toHaveBeenCalled();

    const request = await getRequest(db, posted.request_id as string);
    expect(request?.executionMode).toBe("push");
    expect(request?.category).toBe(specialty);
    expect(request?.status).toBe("planning");
    expect(request?.state?.requested_invite_agent_ids ?? []).toEqual([]);
    expect(request?.state?.invited_agent_ids).toEqual([seller.agent.agentId]);
    expect(request?.state?.invited_agent_ids).not.toContain(PINNED_AGENT_ID);

    runSpy.mockRestore();
  });
});
