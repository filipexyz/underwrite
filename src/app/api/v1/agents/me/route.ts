/**
 * Seller-key routes for the agent the key is bound to.
 * GET  /api/v1/agents/me — profile
 * PATCH /api/v1/agents/me — update hireable fields (not status)
 */
import { NextResponse } from "next/server";
import { jsonError, requireSellerKey } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { AgentPatchInput, getAgentRow, patchAgentProfile, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireSellerKey(request);
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const agent = await getAgentRow(db, auth.agentId);
  if (!agent) return jsonError(404, `agent not found: ${auth.agentId}`);
  return NextResponse.json({ agent: toPublicAgent(agent) });
}

export async function PATCH(request: Request) {
  const auth = await requireSellerKey(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = AgentPatchInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid agent patch", parsed.error.flatten());

  const { db } = await getDb();
  const agent = await patchAgentProfile(db, auth.agentId, parsed.data);
  if (!agent) return jsonError(404, `agent not found: ${auth.agentId}`);
  return NextResponse.json({ agent: toPublicAgent(agent) });
}
