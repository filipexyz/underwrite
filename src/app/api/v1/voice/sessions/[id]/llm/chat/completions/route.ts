/**
 * POST /api/v1/voice/sessions/[id]/llm/chat/completions — our LLM stage, as Agora calls it.
 *
 * This route is what makes `runVoiceLlmTurn` **connected**. Without it the tool loop is a function nobody
 * invokes, which is the same mistake as a `/submit` endpoint nothing can call.
 *
 * The path carries the session id because Agora needs a URL per agent session, and the stage must know
 * which conversation — and therefore which buyer — a tool call belongs to. Deriving it from the URL means
 * the model's own output can never point a task at someone else's wallet.
 *
 * Auth: `Authorization: Bearer <VOICE_LLM_TOKEN>` when that variable is set. When it is not set the route
 * still refuses a non-live session, so the only thing an unauthenticated caller can reach is a session that
 * is currently in a call — but **set the variable**: an unauthenticated completions endpoint is an open
 * inference proxy, and the log says so on every request.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { voiceSessions } from "@/lib/db/schema";
import { runVoiceLlmTurn, type VoiceLlmTurn } from "@/lib/voice/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ChatMessage = { role?: string; content?: unknown };

/** Flatten OpenAI-style content (string or parts) into plain text for the provider. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : "",
      )
      .join("")
      .trim();
  }
  return "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const expected = (process.env.VOICE_LLM_TOKEN ?? "").trim();
  if (expected) {
    const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (presented !== expected) return jsonError(401, "invalid voice llm token");
  } else {
    console.warn("[voice-llm] VOICE_LLM_TOKEN is unset — the completions route is unauthenticated");
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const messages = (body as { messages?: ChatMessage[] })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(422, "messages are required");
  }

  const { db } = await getDb();
  // Called by Agora, not a signed-in browser, so ownership is not checkable here: the unguessable session
  // id in the path is the credential, and it only resolves while the session is live.
  const [session] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, id)).limit(1);
  if (!session) return jsonError(404, "session not found");
  if (session.status !== "live") return jsonError(409, `session is ${session.status}`);

  const turns: VoiceLlmTurn[] = messages
    .map((message) => ({ role: message.role, content: textOf(message.content) }))
    .filter((turn): turn is VoiceLlmTurn => turn.role === "system" || turn.role === "user" || turn.role === "assistant")
    .filter((turn) => turn.content.length > 0);
  if (turns.length === 0) return jsonError(422, "messages contained no text");

  try {
    const result = await runVoiceLlmTurn({ sessionId: id, userId: session.userId, turns });
    return NextResponse.json({
      id: `chatcmpl_${session.id}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "underwrite-voice",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.text },
          finish_reason: "stop",
        },
      ],
      // Not part of the OpenAI schema, but harmless and useful: the caller can tell whether the end tool ran.
      underwrite: { request_id: result.request_id, submitted: result.submitted },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice llm stage failed";
    console.error("[voice-llm] completion failed:", error);
    return jsonError(502, message);
  }
}
