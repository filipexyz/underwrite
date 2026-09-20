/**
 * Owner-only seller-key mint for one agent.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { issueApiKey, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { bindHostedSellerKey } from "@/lib/marketplace/agent-runtime";
import { getOwnedAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MintKey = z.object({
  name: z.string().trim().min(1).max(80).default("seller"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "body must be JSON");
    }
  }
  const parsed = MintKey.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid key request", parsed.error.flatten());

  const { db } = await getDb();
  const agent = await getOwnedAgent(db, id, auth.identity.userId);
  if (!agent) return jsonError(404, `agent not found: ${id}`);

  const issued = await issueApiKey(db, {
    name: parsed.data.name,
    role: "seller",
    ownerUserId: auth.identity.userId,
    agentId: agent.agentId,
    scopes: ["agents:me"],
  });
  await bindHostedSellerKey(db, agent.agentId, issued.secret, issued.row.id);
  return NextResponse.json(
    {
      key: toPublicApiKey(issued.row),
      secret: issued.secret,
      warning: "copy this seller secret now — the UI will not show it again",
    },
    { status: 201 },
  );
}
