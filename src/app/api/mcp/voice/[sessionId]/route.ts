/**
 * Internal MCP server for the voice composer — `/api/mcp/voice/[sessionId]`.
 *
 * Agora's ConvoAI engine is the MCP **client**: it drives `initialize` → `notifications/initialized` →
 * `tools/list` → `tools/call`, exactly as `AgoraIO-Conversational-AI/server-mcp` describes. We host the
 * server, so the tool executes in our process against our own data and the model receives the result as
 * context — which is what lets it say "the task is posted" only after it actually is.
 *
 * Session id in the path, mirroring that recipe's `/mcp/{user_id}` partition: it decides which buyer a task
 * belongs to, so a tool call can never aim a task at someone else's wallet.
 *
 * Auth: the Agora app certificate reused as the shared secret — Agora's cloud is the only caller and already
 * holds it. No new environment variable.
 *
 * JSON-RPC 2.0 over HTTP with plain JSON responses. Streamable HTTP permits SSE, but every method here
 * returns immediately, so a stream would add a failure mode for nothing.
 */
import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { voiceSessions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { submitVoiceBrief, submitTaskToolName } from "@/lib/voice/flow";
import { runMarketplace } from "@/mastra";
import { appendVoiceTranscript } from "@/lib/voice/store";
import { DEFAULT_VOICE_CATEGORY, VoiceTaskBrief } from "@/lib/voice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wire protocol version we advertise. The client proposes one; we answer with ours. */
const PROTOCOL_VERSION = "2024-11-05";

const SUBMIT_TASK_INPUT_SCHEMA = {
  type: "object",
  properties: {
    requirement: { type: "string", description: "What must be delivered, specific enough to be objectively checked." },
    max_cost_usd: { type: "number", description: "Maximum price the buyer agreed to pay, in US dollars." },
    max_latency_s: { type: "number", description: "Maximum time the buyer agreed to wait, in seconds." },
    min_confidence: { type: "number", description: "Minimum confidence required, as a fraction; 95% is 0.95." },
    failure_policy: {
      type: "string",
      enum: ["refund", "discount", "accept_flagged"],
      description: "What happens if the work fails verification.",
    },
  },
  required: ["requirement", "max_cost_usd", "max_latency_s", "min_confidence", "failure_policy"],
} as const;

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

function rpcResult(id: unknown, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: unknown, code: number, message: string): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function authorized(request: Request): boolean {
  const expected = String(env.agora.certificate ?? "").trim();
  if (!expected) return false;
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return presented === expected;
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  if (!authorized(request)) return rpcError(null, -32001, "unauthorized");

  const { sessionId } = await context.params;

  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  const { id, method, params } = body;
  console.log("[voice-mcp] request", JSON.stringify({ method, id, session: sessionId }));

  // Mirror MCP traffic into the session transcript so it is visible **on screen** during the call: the
  // composer and the creator's live view already render transcript turns, and server logs are useless to
  // someone who is talking out loud. Best-effort — a trace write must never fail a tool call.
  void note(sessionId, `[mcp] ${method ?? "?"}`);

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "underwrite-voice", version: "1.0.0" },
      });

    case "notifications/initialized":
      // A notification has no id and expects no result; acknowledge with an empty body.
      return new NextResponse(null, { status: 202 });

    case "tools/list":
      return rpcResult(id, {
        tools: [
          {
            name: submitTaskToolName,
            description:
              "Submit the agreed task to the marketplace. Call this once — and only once — you have the deliverable and all four terms. Afterwards tell the person briefly that the task is posted.",
            inputSchema: SUBMIT_TASK_INPUT_SCHEMA,
          },
        ],
      });

    case "tools/call":
      return handleToolCall(sessionId, id, params);

    case "ping":
      return rpcResult(id, {});

    default:
      return rpcError(id, -32601, `method not found: ${method ?? "(none)"}`);
  }
}

/** Session teardown. We hold no per-connection state, so there is nothing to release. */
export async function DELETE(request: Request) {
  if (!authorized(request)) return rpcError(null, -32001, "unauthorized");
  return new NextResponse(null, { status: 200 });
}

/** Append a trace turn to the session; failures are logged and ignored. */
async function note(sessionId: string, text: string): Promise<void> {
  try {
    const { db } = await getDb();
    await appendVoiceTranscript(db, sessionId, [{ role: "system", text }]);
  } catch (error) {
    console.warn("[voice-mcp] trace write failed:", error);
  }
}

async function handleToolCall(
  sessionId: string,
  id: unknown,
  params: Record<string, unknown> | undefined,
): Promise<NextResponse> {
  const name = typeof params?.name === "string" ? params.name : "";
  if (name !== submitTaskToolName) return rpcError(id, -32602, `unknown tool: ${name || "(none)"}`);

  const rawArgs = (params?.arguments ?? {}) as Record<string, unknown>;
  console.log("[voice-mcp] tools/call", JSON.stringify({ session: sessionId, arguments: rawArgs }));

  // A number can arrive as a string through a model's JSON; coerce before validating rather than
  // rejecting a call that is usable.
  const args: Record<string, unknown> = { ...rawArgs };
  for (const key of ["max_cost_usd", "max_latency_s", "min_confidence"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) args[key] = Number(value);
  }

  const parsed = VoiceTaskBrief.safeParse(args);
  if (!parsed.success) {
    // Tool-level failure, not a protocol error: the model reads this and can correct itself in-call.
    return rpcResult(id, {
      content: [{ type: "text", text: `Invalid task: ${JSON.stringify(parsed.error.flatten())}` }],
      isError: true,
    });
  }

  /*
   * A dry run validates the arguments and returns the task that *would* be created, without creating it.
   * That is what makes the endpoint self-testable: the whole validation path can be proven from a button
   * instead of by running a real call and hoping.
   */
  if (rawArgs.dry_run === true) {
    return rpcResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, dry_run: true, would_post: parsed.data }),
        },
      ],
    });
  }

  const { db } = await getDb();
  const [session] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, sessionId)).limit(1);
  if (!session) return rpcError(id, -32002, "session not found");

  try {
    const submitted = await submitVoiceBrief(db, { session, brief: parsed.data });

    /*
     * Start the auction.
     *
     * Creating the request is not the same as running the market: without this the task sits at `received`
     * forever with a single ledger event, which is exactly what a live demo showed — a posted task and
     * nothing happening. The finalize route and the console's fire button both run the loop; the tool path
     * was the one that forgot.
     *
     * `after()` so the tool response is not held open by the marketplace loop: the model needs an answer
     * promptly to keep talking, and Agora is waiting on this request.
     */
    if (submitted.created) {
      after(async () => {
        try {
          await runMarketplace(submitted.requestId);
        } catch (error) {
          // The task exists and is visible; a crashed loop is recoverable by re-running it.
          console.error(`[voice-mcp] marketplace loop for ${submitted.requestId} crashed:`, error);
        }
      });
    }
    console.log("[voice-mcp] submitted", JSON.stringify({ session: sessionId, request_id: submitted.requestId }));
    void note(sessionId, `[mcp] submitted ${submitted.requestId}`);
    return rpcResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            request_id: submitted.requestId,
            created: submitted.created,
            category: parsed.data.category ?? DEFAULT_VOICE_CATEGORY,
            message: "Task posted to the marketplace. Tell the person it is posted and that they can follow it on screen.",
          }),
        },
      ],
    });
  } catch (error) {
    console.error(`[voice-mcp] submit failed for ${sessionId}:`, error);
    return rpcResult(id, {
      content: [{ type: "text", text: "Could not post the task. Tell the person it failed." }],
      isError: true,
    });
  }
}
