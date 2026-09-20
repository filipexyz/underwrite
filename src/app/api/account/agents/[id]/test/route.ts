/**
 * Owner-only Cloudflare agent test area.
 * GET = runtime diagnosis. POST = real push job inviting this agent.
 */
import { NextResponse } from "next/server";
import { jsonError, modelProviderUnavailableResponse } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getPublicAgentRuntime } from "@/lib/marketplace/agent-runtime";
import {
  AgentTestError,
  AgentTestInput,
  diagnoseAgentTest,
  listRecentAgentTests,
  startOwnedAgentTest,
} from "@/lib/marketplace/agent-test";
import { getOwnedAgent, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const agent = await getOwnedAgent(db, id, auth.identity.userId);
  if (!agent) return jsonError(404, `agent not found: ${id}`);
  const runtime = await getPublicAgentRuntime(db, agent.agentId, agent.webhookUrl);
  const [readiness, recent] = await Promise.all([
    diagnoseAgentTest(db, agent, runtime, auth.identity.userId),
    listRecentAgentTests(db, auth.identity.userId, agent.agentId),
  ]);
  return NextResponse.json({
    agent: toPublicAgent(agent),
    runtime,
    readiness,
    recent,
    selection: {
      mode: "invite_agent_ids",
      category: "html_to_pdf",
      note: "The test job is a real POST /api/v1/requests (execution_mode: push) as your user wallet, with invite_agent_ids pinned to this agent. Without that field the marketplace invites Top-K hireable html_to_pdf agents and prefers those with a webhook.",
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  const providerDenied = modelProviderUnavailableResponse();
  if (providerDenied) return providerDenied;

  let body: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "body must be JSON");
    }
  }
  const parsed = AgentTestInput.safeParse(body ?? {});
  if (!parsed.success) return jsonError(422, "invalid test request", parsed.error.flatten());

  const { id } = await params;
  const { db } = await getDb();
  try {
    const job = await startOwnedAgentTest(db, auth.identity.userId, id, parsed.data);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof AgentTestError) return jsonError(error.status, error.message, error.details);
    throw error;
  }
}
