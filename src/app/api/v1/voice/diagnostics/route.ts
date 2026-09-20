/**
 * GET /api/v1/voice/diagnostics — validate the voice path and show the answer, instead of discovering it by
 * running a real call.
 *
 * Asked for directly: *"tu poderia ter muito bem feito uma forma de a gente validar isso e ver. Eu podia
 * conseguir ver na tela se ele tá funcionando, se ele tá conseguindo conectar com o MCP."*
 *
 * He is right, and this is the answer to it. Tonight's failures were all **silent**: a wrong tool path (a
 * doubled `/api/v1`), a wallet with no credit reported as an opaque `invalid_request_error`, an agent that
 * never joined while the API said "started". None of them would have survived a single self-test.
 *
 * So this endpoint actually calls our own MCP server the way Agora does — over HTTP, to the public origin,
 * with the certificate — and reports each response verbatim. That proves DNS, routing, the auth header, the
 * JSON-RPC handshake and the tool schema in one request.
 *
 * It is deliberately a **read-only** check: the `tools/call` it makes is a dry run, so validating the path
 * can never post a task or charge a wallet.
 */
import { NextResponse } from "next/server";
import { requireSignedInApi } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/auth/origin";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Step = {
  name: string;
  ok: boolean;
  detail: string;
  status?: number;
  body?: unknown;
};

const SAMPLE_ARGS = {
  requirement: "Diagnostic sample — never posted (dry run).",
  max_cost_usd: 0.05,
  max_latency_s: 30,
  min_confidence: 0.95,
  failure_policy: "refund",
  dry_run: true,
};

async function rpc(url: string, method: string, params: unknown, token: string): Promise<Step> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
      cache: "no-store",
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep the raw text so a non-JSON response is visible */
    }
    /*
     * HTTP 200 with a JSON-RPC `error` in the body is a failed step. Treating the status code as the
     * verdict is the same silent-success mistake this whole endpoint exists to catch — it reported a
     * green tick for `tools/call` while the tool was returning "session not found".
     */
    const rpcError = Boolean(body && typeof body === "object" && "error" in body);
    return {
      name: method,
      ok: res.ok && !rpcError,
      detail: rpcError ? "json-rpc error" : res.ok ? "responded" : "non-2xx",
      status: res.status,
      body,
    };
  } catch (error) {
    return { name: method, ok: false, detail: error instanceof Error ? error.message : "fetch failed" };
  }
}

export async function GET() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  const origin = publicOrigin();
  const token = String(env.agora.certificate ?? "");

  // The id is a placeholder: `initialize` and `tools/list` do not read it, and the dry run does not post.
  const url = `${origin}/api/mcp/voice/diagnostics-self-test`;
  const declaredForNewSessions = `${origin}/api/mcp/voice/<sessionId>`;

  const config = {
    agora_enabled: env.agora.enabled,
    agora_missing: env.agora.missing,
    gpt_live_model: env.agora.model,
    gpt_live_voice: env.agora.voice,
    openai_key_configured: Boolean(env.agora.openaiKey),
    model_provider_enabled: env.modelProvider.enabled,
    plan_window_ms: env.planWindowMs,
    declared_origin: origin,
    declared_mcp_endpoint: declaredForNewSessions,
  };

  if (!token) {
    return NextResponse.json({
      config,
      steps: [
        {
          name: "configuration",
          ok: false,
          detail: "AGORA_APP_CERTIFICATE is unset, so the MCP endpoint cannot authenticate Agora",
        },
      ],
      verdict: "blocked: Agora is not configured",
    });
  }

  const steps: Step[] = [
    await rpc(url, "initialize", {}, token),
    await rpc(url, "tools/list", {}, token),
    await rpc(url, "tools/call", { name: "submit_task", arguments: SAMPLE_ARGS }, token),
  ];

  const toolList = steps[1]?.body as { result?: { tools?: Array<{ name: string }> } } | undefined;
  const toolNames = toolList?.result?.tools?.map((t) => t.name) ?? [];
  const callResult = steps[2]?.body as { result?: { content?: Array<{ text?: string }>; isError?: boolean } } | undefined;
  const dryRunOk = callResult?.result?.isError !== true && Boolean(callResult?.result?.content?.[0]?.text);

  // A declared origin that is not reachable is the exact failure that cost us hours, so it is called out.
  const originLooksLocal = /localhost|127\.0\.0\.1/.test(origin);
  const allOk = steps.every((s) => s.ok) && toolNames.includes("submit_task") && dryRunOk && !originLooksLocal;

  return NextResponse.json({
    config,
    steps,
    tools: toolNames,
    verdict: allOk
      ? "ok: our MCP server answers initialize, lists submit_task, and validates a dry-run call"
      : originLooksLocal
        ? "blocked: the declared origin is localhost, so Agora cannot reach this deployment"
        : "failed: see the steps above",
  });
}
