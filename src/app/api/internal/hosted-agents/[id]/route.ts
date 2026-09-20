/**
 * Worker-trusted credential pull. Auth is `UNDERWRITE_HOSTED_RUNTIME_SECRET`,
 * not Clerk and not a user `uw_seller_` key.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireHostedRuntime } from "@/lib/auth/runtime";
import { getDb } from "@/lib/db/client";
import { loadHostedAgentBundle } from "@/lib/marketplace/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireHostedRuntime(request.headers);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const bundle = await loadHostedAgentBundle(db, id);
  if (!bundle) return jsonError(404, `hosted agent not found: ${id}`);
  return NextResponse.json({ agent: bundle });
}
