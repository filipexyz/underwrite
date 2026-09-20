/**
 * Owner-only agent detail and patch (profile + enable/disable).
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getPublicAgentRuntime } from "@/lib/marketplace/agent-runtime";
import { getWallet } from "@/lib/marketplace/credits";
import { AgentOwnerPatchInput, getOwnedAgent, patchOwnedAgent, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const agent = await getOwnedAgent(db, id, auth.identity.userId);
  if (!agent) return jsonError(404, `agent not found: ${id}`);
  const [wallet, keyRows, runtime] = await Promise.all([
    getWallet(db, agent.agentId),
    listApiKeys(db, { ownerUserId: auth.identity.userId, agentId: agent.agentId }),
    getPublicAgentRuntime(db, agent.agentId, agent.webhookUrl),
  ]);
  return NextResponse.json({
    agent: toPublicAgent(agent),
    runtime,
    wallet: {
      owner_id: agent.agentId,
      balance_usd: wallet?.capitalUsd ?? 0,
    },
    keys: keyRows.map(toPublicApiKey),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = AgentOwnerPatchInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid agent patch", parsed.error.flatten());

  const { db } = await getDb();
  const row = await patchOwnedAgent(db, id, auth.identity.userId, parsed.data);
  if (!row) return jsonError(404, `agent not found: ${id}`);
  return NextResponse.json({ agent: toPublicAgent(row) });
}
