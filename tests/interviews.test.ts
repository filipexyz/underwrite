import { beforeAll, describe, expect, it } from "vitest";
import { POST as startNeed } from "@/app/api/v1/interviews/needs/[id]/start/route";
import { POST as createNeedRoute, GET as listNeedsRoute } from "@/app/api/v1/interviews/needs/route";
import { GET as publicGet } from "@/app/api/v1/interviews/i/[token]/route";
import { POST as publicStart } from "@/app/api/v1/interviews/i/[token]/start/route";
import { POST as publicFinalize } from "@/app/api/v1/interviews/i/[token]/finalize/route";
import { POST as finalizeRoute } from "@/app/api/v1/interviews/sessions/[id]/finalize/route";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { extractAnswersFromTranscript, extractLastJsonObject, normalizeAnswers } from "@/lib/interviews/extract";
import { buildInterviewGreeting, buildInterviewPrompt } from "@/lib/interviews/prompt";
import { parseRtmMessage, upsertTranscript } from "@/lib/interviews/rtm";
import { createNeed, finalizeSession, getNeed, getNeedByToken, insertLiveSession, listNeeds } from "@/lib/interviews/store";
import type { InterviewBrief } from "@/lib/interviews/types";

const brief: InterviewBrief = {
  goal: "Learn how a seller underwrites PDF jobs",
  questions: ["What do you deliver?", "How do you score confidence?"],
  context: "Hackathon seller desk",
  required_fields: ["deliverable", "confidence_method"],
  success_criteria: "Both fields filled",
};

describe("interview extract + prompt", () => {
  it("parses the last JSON object from an assistant wrap-up", () => {
    const parsed = extractLastJsonObject(
      'Thanks, that covers it. {"answers":{"deliverable":"PDF","confidence_method":"rubric"},"notes":"clear"} leftover',
    );
    expect(parsed).toEqual({
      answers: { deliverable: "PDF", confidence_method: "rubric" },
      notes: "clear",
    });
  });

  it("normalizes flat maps onto required field names", () => {
    const answers = normalizeAnswers({ Deliverable: "HTML→PDF", extra: "x" }, ["deliverable", "confidence_method"]);
    expect(answers?.answers.deliverable).toBe("HTML→PDF");
    expect(answers?.source).toBe("partial");
  });

  it("reads answers from the last assistant turn", () => {
    const answers = extractAnswersFromTranscript(
      [
        { role: "assistant", text: "What do you deliver?" },
        { role: "user", text: "A compiled PDF." },
        {
          role: "assistant",
          text: 'Done. {"answers":{"deliverable":"compiled PDF","confidence_method":"judges + rubric"}}',
        },
      ],
      brief.required_fields,
    );
    expect(answers?.answers).toEqual({
      deliverable: "compiled PDF",
      confidence_method: "judges + rubric",
    });
    expect(answers?.source).toBe("agent_json");
  });

  it("builds an interviewer prompt that lists every question and field", () => {
    const prompt = buildInterviewPrompt(brief);
    expect(prompt).toContain("Ask exactly one question");
    expect(prompt).toContain("What do you deliver?");
    expect(prompt).toContain("- deliverable");
    expect(buildInterviewGreeting(brief)).toContain("What do you deliver?");
  });
});

describe("interview RTM parse", () => {
  it("maps assistant.transcription and agent state", () => {
    const turn = parseRtmMessage(
      JSON.stringify({
        object: "assistant.transcription",
        text: "First question.",
        turn_id: 1,
        turn_status: 1,
        start_ms: 1_700_000_000_000,
      }),
    );
    expect(turn).toMatchObject({ kind: "transcript", inProgress: false, turn: { role: "assistant", text: "First question." } });

    const state = parseRtmMessage(JSON.stringify({ object: "message.state", payload: { value: "listening" } }));
    expect(state).toEqual({ kind: "state", state: "listening" });
  });

  it("replaces an in-progress turn with the same turn_id", () => {
    const first = upsertTranscript([], { role: "assistant", text: "Hel", turn_id: 2 }, true);
    const next = upsertTranscript(first, { role: "assistant", text: "Hello there", turn_id: 2 }, false);
    expect(next).toHaveLength(1);
    expect(next[0].text).toBe("Hello there");
  });
});

describe("interview store + HTTP", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("creates, lists, and finalizes a need without Agora (answers from transcript JSON)", async () => {
    expect(env.agora.enabled).toBe(false);

    const { db } = await getDb();
    const need = await createNeed(db, { title: "Seller desk", brief }, "user_test");
    expect(need.status).toBe("open");
    expect(need.publicToken.length).toBeGreaterThan(16);
    expect(await getNeedByToken(db, need.publicToken)).toMatchObject({ id: need.id });
    const listed = await listNeeds(db, 10);
    expect(listed.some((row) => row.id === need.id)).toBe(true);

    const session = await insertLiveSession(db, need, "interview-test-channel");
    const result = await finalizeSession(db, session, {
      transcript_json: [
        {
          role: "assistant",
          text: '{"answers":{"deliverable":"PDF","confidence_method":"rubric v0"},"notes":"solid"}',
        },
      ],
    });
    expect(result.need.status).toBe("completed");
    expect(result.need.resultJson).toMatchObject({
      answers: { deliverable: "PDF", confidence_method: "rubric v0" },
    });
    expect(result.session.status).toBe("completed");
    const reloaded = await getNeed(db, need.id);
    expect(reloaded?.completedAt).toBeTruthy();
  });

  it("POST /needs then GET list; start is 503 when Agora keys are missing", async () => {
    const create = await createNeedRoute(
      new Request("http://localhost/api/v1/interviews/needs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Via HTTP", brief }),
      }),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { need: { id: string }; agora: { enabled: boolean } };
    expect(created.agora.enabled).toBe(false);
    expect(created.need.id).toMatch(/^need_/);

    const list = await listNeedsRoute(new Request("http://localhost/api/v1/interviews/needs"));
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { needs: { id: string }[] };
    expect(listed.needs.some((n) => n.id === created.need.id)).toBe(true);

    const start = await startNeed(new Request(`http://localhost/api/v1/interviews/needs/${created.need.id}/start`, { method: "POST" }), {
      params: Promise.resolve({ id: created.need.id }),
    });
    expect(start.status).toBe(503);
    const body = (await start.json()) as { error: string; details: { missing: string[] } };
    expect(body.error).toMatch(/Agora/);
    expect(body.details.missing.length).toBeGreaterThan(0);
  });

  it("finalize HTTP persists client-supplied answers", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "HTTP finalize", brief }, "local-dev");
    const session = await insertLiveSession(db, need, "interview-http-finalize");
    const res = await finalizeRoute(
      new Request(`http://localhost/api/v1/interviews/sessions/${session.id}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript_json: [{ role: "user", text: "We ship PDFs." }],
          answers_json: { answers: { deliverable: "PDF", confidence_method: "self-report" } },
        }),
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { need: { status: string; result_json: { answers: Record<string, string> } } };
    expect(body.need.status).toBe("completed");
    expect(body.need.result_json.answers.deliverable).toBe("PDF");
  });

  it("public invite: lookup works, start is 503 without Agora, finalize persists, then start is 410", async () => {
    const { db } = await getDb();
    const need = await createNeed(db, { title: "Public link", brief }, "local-dev");
    const token = need.publicToken;

    const lookup = await publicGet(new Request(`http://localhost/api/v1/interviews/i/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(lookup.status).toBe(200);
    const publicBody = (await lookup.json()) as { interview: { title: string; completed: boolean } };
    expect(publicBody.interview.title).toBe("Public link");
    expect(publicBody.interview.completed).toBe(false);

    const missing = await publicGet(new Request("http://localhost/api/v1/interviews/i/nope"), {
      params: Promise.resolve({ token: "nope" }),
    });
    expect(missing.status).toBe(404);

    const start = await publicStart(new Request(`http://localhost/api/v1/interviews/i/${token}/start`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
    expect(start.status).toBe(503);

    await insertLiveSession(db, need, "interview-public");
    const done = await publicFinalize(
      new Request(`http://localhost/api/v1/interviews/i/${token}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers_json: { answers: { deliverable: "PDF", confidence_method: "rubric" } },
        }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(done.status).toBe(200);

    const again = await publicStart(new Request(`http://localhost/api/v1/interviews/i/${token}/start`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    });
    expect(again.status).toBe(410);
  });
});
