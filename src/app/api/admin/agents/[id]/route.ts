import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { requireAdminApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AGENT_STATUSES } from "@/lib/db/schema";
import { enableStatusFor, getAgentRow, setAgentStatus, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchAgent = z.object({
  status: z.enum(AGENT_STATUSES),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = PatchAgent.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid status", parsed.error.flatten());

  const { db } = await getDb();
  const existing = await getAgentRow(db, id);
  if (!existing) return jsonError(404, `agent not found: ${id}`);

  const status = parsed.data.status === "disabled" ? "disabled" : enableStatusFor(existing);
  const row = await setAgentStatus(db, id, parsed.data.status === "disabled" ? "disabled" : status);
  if (!row) return jsonError(404, `agent not found: ${id}`);
  return NextResponse.json({ agent: toPublicAgent(row) });
}
