/**
 * Clerk-session seller list / register / owner patch.
 * GET   — agents this user owns (wallet included; agents start at $0)
 * POST  — register (seller secret once)
 * PATCH — owner edit/disable when `agent_id` is in the body
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  AgentOwnerPatchInput,
  AgentCreateInput,
  listOwnedAgents,
  patchOwnedAgent,
  registerSellerAgent,
  toOwnedAgentView,
  toPublicAgent,
} from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CollectionPatch = AgentOwnerPatchInput.extend({
  agent_id: z.string().trim().min(1),
});

export async function GET() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const rows = await listOwnedAgents(db, auth.identity.userId);
  const agents = await Promise.all(rows.map((row) => toOwnedAgentView(db, row)));
  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = AgentCreateInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid agent", parsed.error.flatten());

  const { db } = await getDb();
  const created = await registerSellerAgent(db, auth.identity.userId, parsed.data);
  return NextResponse.json(
    {
      agent: toPublicAgent(created.agent),
      runtime: created.runtime,
      key: created.key,
      secret: created.secret,
      webhook_secret: created.webhook_secret,
      warning: "copy the seller key and webhook secret now — the UI will not show them again",
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = CollectionPatch.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid agent patch", parsed.error.flatten());

  const { db } = await getDb();
  const { agent_id, ...patch } = parsed.data;
  const row = await patchOwnedAgent(db, agent_id, auth.identity.userId, patch);
  if (!row) return jsonError(404, `agent not found: ${agent_id}`);
  return NextResponse.json({ agent: toPublicAgent(row) });
}
