/**
 * Auth0-session (or local-dev) self-serve key minting.
 * GET  — list this user's keys (prefix / role / revoked; never the secret)
 * POST — create a buyer key, or a seller key bound to an agent they own
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { issueApiKey, listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { bindHostedSellerKey } from "@/lib/marketplace/agent-runtime";
import { getAgentRow } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateKeyInput = z.object({
  name: z.string().trim().min(1).max(80).default("default"),
  role: z.enum(["buyer", "seller"]).default("buyer"),
  agent_id: z.string().min(1).optional(),
});

export async function GET() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const rows = await listApiKeys(db, { ownerUserId: auth.identity.userId });
  return NextResponse.json({ keys: rows.map(toPublicApiKey) });
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
  const parsed = CreateKeyInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid key request", parsed.error.flatten());

  const { db } = await getDb();
  if (parsed.data.role === "seller") {
    if (!parsed.data.agent_id) return jsonError(422, "seller keys require agent_id");
    const agent = await getAgentRow(db, parsed.data.agent_id);
    if (!agent || agent.ownerUserId !== auth.identity.userId) {
      return jsonError(403, "you do not own that agent");
    }
  }

  const issued = await issueApiKey(db, {
    name: parsed.data.name,
    role: parsed.data.role,
    ownerUserId: auth.identity.userId,
    agentId: parsed.data.role === "seller" ? parsed.data.agent_id : null,
    scopes: parsed.data.role === "seller" ? ["agents:me"] : ["requests"],
  });
  if (parsed.data.role === "seller" && parsed.data.agent_id) {
    await bindHostedSellerKey(db, parsed.data.agent_id, issued.secret, issued.row.id);
  }

  return NextResponse.json(
    {
      key: toPublicApiKey(issued.row),
      secret: issued.secret,
      warning: "copy this secret now — the UI will not show it again",
    },
    { status: 201 },
  );
}
