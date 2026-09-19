/**
 * Clerk-session seller registration. Same effect as `/agents/register`.
 * The seller API key is returned once.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AgentRegisterInput, listOwnedAgents, registerSellerAgent, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const rows = await listOwnedAgents(db, auth.identity.userId);
  return NextResponse.json({ agents: rows.map(toPublicAgent) });
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
  const parsed = AgentRegisterInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid agent", parsed.error.flatten());

  const { db } = await getDb();
  const created = await registerSellerAgent(db, auth.identity.userId, parsed.data);
  return NextResponse.json(
    {
      agent: toPublicAgent(created.agent),
      key: created.key,
      secret: created.secret,
      warning: "copy this seller secret now — it is not stored and will not be shown again",
    },
    { status: 201 },
  );
}
