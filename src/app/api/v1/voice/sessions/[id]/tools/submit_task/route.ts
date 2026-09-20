/**
 * POST /api/v1/voice/sessions/[id]/tools/submit_task — the end tool's HTTP target.
 *
 * This is the URL declared in the agent's `LlmTool.server`, so **Agora** calls it, synchronously, when the
 * model invokes `submit_task`, and feeds the result back into the model's context. Nothing here is spoken,
 * inferred from wording, or triggered by a timer.
 *
 * Auth: the Agora app certificate, reused as the shared secret — Agora's cloud is the only caller and it
 * already holds that value, so no new environment variable is introduced. The session id in the path is a
 * second guard and, more importantly, decides which buyer the task belongs to: the model cannot aim a task
 * at someone else's wallet because it never supplies the session.
 *
 * The response body is what the model sees, so it is deliberately short and states only what happened.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { voiceSessions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { submitVoiceBrief } from "@/lib/voice/flow";
import { DEFAULT_VOICE_CATEGORY, VoiceTaskBrief } from "@/lib/voice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  console.log("[voice-tool] submit_task invoked");
  const expected = String(env.agora.certificate ?? "").trim();
  if (!expected) return jsonError(503, "agora is not configured");
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (presented !== expected) return jsonError(401, "invalid tool token");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  // Agora renders `{{args.x}}` preserving types, but a numeric argument can still arrive as a string, so
  // coerce before validating rather than rejecting a usable call.
  console.log("[voice-tool] raw body", JSON.stringify(body));
  const coerced = coerceNumbers(body);
  const parsed = VoiceTaskBrief.safeParse(coerced);
  if (!parsed.success) {
    // The model sees this and can correct itself within the same conversation.
    return NextResponse.json(
      { ok: false, error: "invalid_task", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { id } = await params;
  const { db } = await getDb();
  const [session] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, id)).limit(1);
  if (!session) return jsonError(404, "session not found");

  try {
    const submitted = await submitVoiceBrief(db, { session, brief: parsed.data });
    console.log("[voice-tool] submitted", JSON.stringify({ session: id, request_id: submitted.requestId }));
    return NextResponse.json({
      ok: true,
      request_id: submitted.requestId,
      created: submitted.created,
      category: parsed.data.category ?? DEFAULT_VOICE_CATEGORY,
      message: "Task posted to the marketplace. Tell the person it is posted and that they can follow it.",
    });
  } catch (error) {
    console.error(`[voice] submit_task failed for ${id}:`, error);
    return NextResponse.json(
      { ok: false, error: "submit_failed", message: "Could not post the task. Tell the person it failed." },
      { status: 502 },
    );
  }
}

function coerceNumbers(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const source = body as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  for (const key of ["max_cost_usd", "max_latency_s", "min_confidence"]) {
    const value = out[key];
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      out[key] = Number(value);
    }
  }
  return out;
}
