/**
 * POST /api/mcp — the marketplace as an MCP server, authorised by API key.
 *
 * This is the surface for **other agents**. The existing `/api/mcp/voice/{sessionId}` is proof that the
 * protocol works, but it is session-scoped and exists to serve our own voice composer. This one has no
 * session: the key is the identity, and the tools are the marketplace.
 *
 * ```
 * Authorization: Bearer uw_buyer_…    →  post_task · get_task · watch_task · discover_agents
 * Authorization: Bearer uw_seller_…   →  post_plan · submit_deliverable
 * ```
 *
 * Two decisions worth stating:
 *
 * 1. **`tools/list` is filtered by the key's scopes.** A buyer key never *sees* `submit_deliverable`, rather
 *    than being shown a tool that will refuse it. An agent that discovers its own capabilities from
 *    `tools/list` cannot then be surprised by a 403 — and "a tool that silently fails" is the failure mode
 *    that cost this project a day.
 *
 * 2. **Every tool dispatches to the route that already implements it.** Validation, escrow rules, idempotency
 *    and scope checks live in those handlers; re-implementing them here would create a second source of truth
 *    for the marketplace's rules, which is how the two drift apart.
 *
 * API key rather than the spec's OAuth: our callers are unattended agents, and interactive consent is the one
 * thing they cannot do.
 */
import { NextResponse } from "next/server";
import { resolveBuyerAuth, resolveSellerAuth, extractPresentedKey } from "@/lib/auth/api-keys";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

type ToolName =
  | "post_task"
  | "get_task"
  | "watch_task"
  | "discover_agents"
  | "post_plan"
  | "submit_deliverable";

type ToolSpec = {
  name: ToolName;
  side: "buyer" | "seller";
  description: string;
  inputSchema: Record<string, unknown>;
};

const TOOLS: ToolSpec[] = [
  {
    name: "post_task",
    side: "buyer",
    description:
      "Post a task to the marketplace. Provide the requirement plus the terms you commit to: maximum price, maximum time, and the minimum confidence you require. Returns a request_id. Sellers bid; the cheapest compliant bid wins; payment is released only if objective checks pass and the delivered confidence meets your floor.",
    inputSchema: {
      type: "object",
      properties: {
        requirement: { type: "string", description: "What must be delivered, specific enough to be objectively checked." },
        files: {
          type: "array",
          description: "Optional attachments.",
          items: {
            type: "object",
            properties: { name: { type: "string" }, media_type: { type: "string" }, content: { type: "string" } },
            required: ["name", "media_type", "content"],
          },
        },
        max_cost_usd: { type: "number", description: "Maximum price you will pay, in US dollars." },
        max_latency_s: { type: "number", description: "Maximum time you will wait, in seconds." },
        min_confidence: { type: "number", description: "Minimum confidence you require, as a fraction; 95% is 0.95." },
        failure_policy: { type: "string", enum: ["refund", "discount", "accept_flagged"] },
        category: { type: "string", description: "Optional specialty; the verification rubric follows it." },
        wait: { type: "boolean", description: "Block until the task settles instead of returning immediately." },
      },
      required: ["requirement", "max_cost_usd", "max_latency_s", "min_confidence", "failure_policy"],
    },
  },
  {
    name: "get_task",
    side: "buyer",
    description:
      "Read a task: status, bids, plans, escrow state, verification, attribution and the full ledger. Use it to follow a task you posted.",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string" } },
      required: ["request_id"],
    },
  },
  {
    name: "watch_task",
    side: "buyer",
    description:
      "Read ledger events after a cursor. Poll this to follow a running task cheaply — pass the last seq you saw.",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string" }, after: { type: "number", description: "Return events after this seq." } },
      required: ["request_id"],
    },
  },
  {
    name: "discover_agents",
    side: "buyer",
    description:
      "List hireable agents for a specialty, with their trust axes and cost ceilings. This is what a seller's history looks like before you hire it.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", description: "Specialty to discover, e.g. html_to_pdf." } },
      required: ["category"],
    },
  },
  {
    name: "post_plan",
    side: "seller",
    description:
      "Bid on a task you were invited to. One plan per agent per job, and the price in the plan is the price.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string" },
        price_usd: { type: "number" },
        promised_confidence: { type: "number" },
        max_latency_s: { type: "number" },
        deliverable: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["request_id", "price_usd", "promised_confidence", "max_latency_s"],
    },
  },
  {
    name: "submit_deliverable",
    side: "seller",
    description:
      "Deliver the work for a task you won. The platform inspects the bytes you send — it never renders or invents an artefact — and releases payment only if the checks pass.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string" },
        artifact: {
          type: "object",
          properties: {
            pdf_base64: { type: "string" },
            html: { type: "string" },
            markdown: { type: "string" },
            md: { type: "string" },
            zip_base64: { type: "string" },
            artifact_ref: { type: "string" },
            kind: { type: "string", enum: ["pdf", "html", "md", "markdown", "zip"] },
            observed_latency_ms: { type: "number" },
            declared_latency_ms: { type: "number" },
            self_report: { type: "number" },
          },
        },
      },
      required: ["request_id", "artifact"],
    },
  },
];

function rpcResult(id: unknown, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: unknown, code: number, message: string): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/**
 * Which side the key is on, and therefore which tools it may see.
 *
 * A seller key resolves first because it is bound to an agent; anything else is treated as a buyer, matching
 * how the HTTP routes behave when no key is presented at all.
 */
async function resolveCaller(request: Request): Promise<{ side: "buyer" | "seller"; agentId?: string }> {
  const { db } = await getDb();
  const presented = extractPresentedKey(request.headers);

  if (presented) {
    const seller = await resolveSellerAuth({ presented, db });
    if (seller.ok) return { side: "seller", agentId: seller.agentId };
  }

  const buyer = await resolveBuyerAuth({ presented, legacyKey: env.apiKey, db });
  // A failed buyer resolution still leaves the public routes reachable, exactly as they are over HTTP.
  void buyer;
  return { side: "buyer" };
}

export async function POST(request: Request) {
  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  const { id, method, params } = body;
  const caller = await resolveCaller(request);
  console.log("[mcp] request", JSON.stringify({ method, side: caller.side, agent: caller.agentId ?? null }));

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "underwrite-marketplace", version: "1.0.0" },
      });

    case "notifications/initialized":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        // Filtered, not just guarded: see the note at the top of this file.
        tools: TOOLS.filter((tool) => tool.side === caller.side).map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case "tools/call":
      return handleToolCall(request, id, params, caller);

    default:
      return rpcError(id, -32601, `method not found: ${method ?? "(none)"}`);
  }
}

function toolError(id: unknown, text: string): NextResponse {
  // Tool-level failure, not a protocol error: the caller reads it and can correct itself.
  return rpcResult(id, { content: [{ type: "text", text }], isError: true });
}

async function handleToolCall(
  request: Request,
  id: unknown,
  params: Record<string, unknown> | undefined,
  caller: { side: "buyer" | "seller"; agentId?: string },
): Promise<NextResponse> {
  const name = (typeof params?.name === "string" ? params.name : "") as ToolName;
  const spec = TOOLS.find((tool) => tool.name === name);
  if (!spec) return rpcError(id, -32602, `unknown tool: ${name || "(none)"}`);
  if (spec.side !== caller.side) {
    return toolError(id, `this key may not call ${name} — it is a ${caller.side} key`);
  }

  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  const origin = new URL(request.url).origin;
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${origin}${path}`, { ...init, headers });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    return { ok: res.ok, status: res.status, body: parsed };
  };

  try {
    switch (name) {
      case "post_task": {
        const body = {
          task: { requirement: args.requirement, files: args.files ?? [] },
          max_cost_usd: args.max_cost_usd,
          max_latency_s: args.max_latency_s,
          min_confidence: args.min_confidence,
          failure_policy: args.failure_policy,
          ...(args.category ? { category: args.category } : {}),
        };
        const query = args.wait === true ? "?wait=1" : "";
        return shape(id, await call(`/api/v1/requests${query}`, { method: "POST", body: JSON.stringify(body) }));
      }

      case "get_task":
        return shape(id, await call(`/api/v1/requests/${encodeURIComponent(String(args.request_id))}`));

      case "watch_task": {
        const after = Number(args.after ?? 0) || 0;
        return shape(
          id,
          await call(`/api/v1/requests/${encodeURIComponent(String(args.request_id))}/events?after=${after}`),
        );
      }

      case "discover_agents": {
        const { loadRegistry, isHireableAgent } = await import("@/lib/marketplace/registry");
        const { db } = await getDb();
        const registry = await loadRegistry(db, String(args.category));
        const agents = [...registry.agents.values()]
          .filter((agent) => isHireableAgent(agent) && agent.specialties.includes(String(args.category)))
          .map((agent) => ({
            agent_id: agent.agentId,
            role: agent.role,
            specialties: agent.specialties,
            cost_ceiling_usd: agent.costCeilingUsd,
            latency_class: agent.latencyClass,
            trust_global: agent.trust_global,
            axes: agent.axes,
          }));
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify({ agents }, null, 2) }] });
      }

      case "post_plan": {
        const { request_id: requestId, ...plan } = args;
        return shape(
          id,
          await call(`/api/v1/jobs/${encodeURIComponent(String(requestId))}/plans`, {
            method: "POST",
            body: JSON.stringify(plan),
          }),
        );
      }

      case "submit_deliverable": {
        const { request_id: requestId, artifact } = args;
        return shape(
          id,
          await call(`/api/v1/jobs/${encodeURIComponent(String(requestId))}/deliverables`, {
            method: "POST",
            body: JSON.stringify({ artifact }),
          }),
        );
      }

      default:
        return rpcError(id, -32602, `unhandled tool: ${name}`);
    }
  } catch (error) {
    console.error(`[mcp] ${name} failed:`, error);
    return toolError(id, `${name} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/** Wrap a route response as MCP tool content, marking a non-2xx as a tool error rather than a success. */
function shape(id: unknown, res: { ok: boolean; status: number; body: unknown }): NextResponse {
  return rpcResult(id, {
    content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }],
    isError: !res.ok,
    underwrite: { status: res.status },
  });
}
