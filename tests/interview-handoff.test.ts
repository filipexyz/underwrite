/**
 * Interview → marketplace handoff, and the live transcript write path.
 *
 * The handoff is the piece that used to be missing: a finished voice interview produced structured
 * answers and nothing consumed them, so the creator still had to hand-write the task.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { POST as appendTranscript } from "@/app/api/v1/interviews/i/[token]/transcript/route";
import { getDb } from "@/lib/db/client";
import { composeRequirement, createTaskFromInterview, interviewToRequestInput } from "@/lib/interviews/handoff";
import {
  MAX_TRANSCRIPT_TURNS_PER_WRITE,
  appendTranscriptTurns,
  createNeed,
  finalizeSession,
  getNeed,
  getNeedByToken,
  insertLiveSession,
} from "@/lib/interviews/store";
import type { InterviewBrief } from "@/lib/interviews/types";
import { listEvents } from "@/lib/ledger/ledger";
import { getRequest } from "@/lib/marketplace/requests";

const brief: InterviewBrief = {
  goal: "Produce a launch page for the agent marketplace",
  questions: ["What is the product?", "Who is the audience?"],
  context: "Hackathon launch week",
  required_fields: ["product", "audience"],
  success_criteria: "Both fields answered",
  task: {
    max_cost_usd: 0.42,
    max_latency_s: 90,
    min_confidence: 0.9,
    failure_policy: "discount",
    category: "html_to_pdf",
    invite_agent_ids: [],
  },
};

const answers = {
  answers: { product: "An A2A marketplace for confidence SLAs", audience: "Agent builders" },
  notes: "Wants it before Sunday",
} as const;

beforeAll(async () => {
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  const handle = await getDb();
  await handle.migrate();
});

describe("requirement composition", () => {
  it("keeps the human's own words and marks unanswered fields", () => {
    const need = { title: "Launch page", brief };
    const text = composeRequirement(need, {
      answers: { product: "An A2A marketplace", audience: "   " },
    });
    expect(text).toContain("# Launch page");
    expect(text).toContain("Produce a launch page for the agent marketplace");
    expect(text).toContain("Hackathon launch week");
    // The answer is verbatim: the task statement must not paraphrase the person who gave it.
    expect(text).toContain("**product**: An A2A marketplace");
    // Declared-but-blank is surfaced, not silently dropped.
    expect(text).toContain("**audience**: _not answered_");
  });

  it("includes undeclared answers too, after the declared ones", () => {
    const need = { title: "Launch page", brief };
    const text = composeRequirement(need, { answers: { product: "P", audience: "A", extra: "E" } });
    expect(text.indexOf("**product**")).toBeLessThan(text.indexOf("**extra**"));
    expect(text).toContain("**extra**: E");
  });

  it("bounds the requirement so a runaway transcript cannot produce an unbounded task", () => {
    const huge = "x".repeat(20_000);
    const text = composeRequirement({ title: "Big", brief }, { answers: { product: huge } });
    expect(text.length).toBeLessThanOrEqual(4_000);
  });
});

describe("terms mapping", () => {
  it("uses the brief's committed terms", () => {
    const input = interviewToRequestInput({ title: "Launch page", brief }, { ...answers });
    expect(input.max_cost_usd).toBe(0.42);
    expect(input.max_latency_s).toBe(90);
    expect(input.min_confidence).toBe(0.9);
    expect(input.failure_policy).toBe("discount");
    expect(input.category).toBe("html_to_pdf");
  });

  it("falls back to platform defaults for a brief written before terms existed", () => {
    const legacy: InterviewBrief = { ...brief, task: undefined };
    const input = interviewToRequestInput({ title: "Legacy", brief: legacy }, { ...answers });
    expect(input.max_cost_usd).toBe(0.05);
    expect(input.failure_policy).toBe("refund");
  });
});

describe("task handoff", () => {
  it("creates the request once, attributed to the interview agent", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Handoff need", brief }, "local-dev");

    const first = await createTaskFromInterview(db, { need, answers: { ...answers } });
    expect(first.created).toBe(true);

    const request = await getRequest(db, first.requestId);
    expect(request?.requirement).toContain("An A2A marketplace for confidence SLAs");
    expect(request?.maxCostUsd).toBe(0.42);

    // Attribution: the interview agent filed it, not a human, so nothing lands after
    // `request_received` with `actor: "human"`.
    const events = await listEvents(db, first.requestId);
    const received = events.find((e) => e.type === "request_received");
    expect(received?.payload.actor).toBe("agent");
    expect(received?.payload.source).toBe("interview");

    // Idempotent: a retried finalize must not create a second task.
    const second = await createTaskFromInterview(db, { need, answers: { ...answers } });
    expect(second.created).toBe(false);
    expect(second.requestId).toBe(first.requestId);

    const stamped = await getNeed(db, need.id);
    expect(stamped?.requestId).toBe(first.requestId);
  });

  it("files the task when a real session finalizes", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Finalize need", brief }, "local-dev");
    const session = await insertLiveSession(db, need, "interview-test-channel");

    // Known-answer convention: `answers_json` short-circuits extraction, so no inference needed.
    const result = await finalizeSession(db, session, { answers_json: { ...answers } });
    expect(result.need.requestId).toBeTruthy();

    const request = await getRequest(db, result.need.requestId as string);
    expect(request?.status).toBe("received");
    expect(request?.buyerWalletId).toBe("local-dev");
  });

  it("does not hand off an incomplete interview", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Incomplete need", brief }, "local-dev");
    const session = await insertLiveSession(db, need, "interview-test-incomplete");

    await expect(
      finalizeSession(db, session, { answers_json: { answers: { product: "P" } } }),
    ).rejects.toThrow();

    const after = await getNeed(db, need.id);
    expect(after?.requestId).toBeNull();
    expect(after?.status).not.toBe("completed");
  });
});

describe("live transcript append", () => {
  it("merges by turn_id instead of duplicating", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Transcript need", brief }, "local-dev");
    const session = await insertLiveSession(db, need, "interview-test-transcript");

    await appendTranscriptTurns(db, session.id, [
      { role: "assistant", text: "Hello", turn_id: 1 },
      { role: "user", text: "Hi there", turn_id: 2 },
    ]);
    const grown = await appendTranscriptTurns(db, session.id, [
      { role: "assistant", text: "Hello, welcome", turn_id: 1 },
    ]);
    expect(grown.turns.filter((t) => t.turn_id === 1)).toHaveLength(1);
    expect(grown.turns.find((t) => t.turn_id === 1)?.text).toBe("Hello, welcome");
  });

  it("refuses to append to a finished session", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Frozen need", brief }, "local-dev");
    const session = await insertLiveSession(db, need, "interview-test-frozen");
    await finalizeSession(db, session, { answers_json: { ...answers } });

    const result = await appendTranscriptTurns(db, session.id, [{ role: "user", text: "late" }]);
    expect(result.skipped).toBe(1);
    expect(result.turns.some((t) => t.text === "late")).toBe(false);
  });

  it("rejects an oversized body at the route, and accepts a bounded one", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Route need", brief }, "local-dev");
    await insertLiveSession(db, need, "interview-test-route");
    // Re-read so `assignedSessionId` is populated on the row the route resolves.
    const stored = await getNeedByToken(db, need.publicToken);
    expect(stored).toBeTruthy();

    const tooMany = {
      transcript_json: Array.from({ length: MAX_TRANSCRIPT_TURNS_PER_WRITE + 1 }, (_, i) => ({
        role: "user",
        text: `turn ${i}`,
      })),
    };
    const rejected = await appendTranscript(
      new Request(`http://localhost:3000/api/v1/interviews/i/${need.publicToken}/transcript`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tooMany),
      }),
      { params: Promise.resolve({ token: need.publicToken }) },
    );
    expect(rejected.status).toBe(422);

    const ok = await appendTranscript(
      new Request(`http://localhost:3000/api/v1/interviews/i/${need.publicToken}/transcript`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript_json: [{ role: "user", text: "hello" }] }),
      }),
      { params: Promise.resolve({ token: need.publicToken }) },
    );
    expect(ok.status).toBe(200);
  });

  it("404s an unknown invite token", async () => {
    const res = await appendTranscript(
      new Request("http://localhost:3000/api/v1/interviews/i/nope/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript_json: [{ role: "user", text: "hello" }] }),
      }),
      { params: Promise.resolve({ token: "nope" }) },
    );
    expect(res.status).toBe(404);
  });
});
