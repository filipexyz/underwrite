/**
 * Worker-trusted credential pull. Auth is `UNDERWRITE_HOSTED_RUNTIME_SECRET`,
 * not an Auth0 session and not a user `uw_seller_` key.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireHostedRuntime } from "@/lib/auth/runtime";
import { getDb } from "@/lib/db/client";
import { loadHostedAgentBundle, recordRuntimeLastError } from "@/lib/marketplace/agent-runtime";

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

/** Worker reports a fiber / plan failure so the test area can show last_error. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireHostedRuntime(request.headers);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const lastError =
    body && typeof body === "object" && "last_error" in body
      ? (body as { last_error: unknown }).last_error
      : undefined;
  if (lastError !== null && lastError !== undefined && typeof lastError !== "string") {
    return jsonError(422, "last_error must be a string or null");
  }
  const { db } = await getDb();
  const bundle = await loadHostedAgentBundle(db, id);
  if (!bundle) return jsonError(404, `hosted agent not found: ${id}`);
  await recordRuntimeLastError(db, id, lastError ?? null);
  return NextResponse.json({ ok: true, agent_id: id, last_error: lastError ?? null });
}
