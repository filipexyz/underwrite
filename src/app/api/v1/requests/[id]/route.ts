/**
 * GET /api/v1/requests/[id] — status, chain, plans, escrows, verification,
 * attribution, the full ledger, and metrics derived from it
 * (`human_interventions` included — it is 0, and it is computed, not stored).
 */
import { NextResponse } from "next/server";
import { jsonError, requireApiKey } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { getRequestDetail, toApiRequest } from "@/lib/marketplace/requests";
import { selectPlansIfReady } from "@/lib/marketplace/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  const { db } = await getDb();
  const detail = await getRequestDetail(db, id);
  if (!detail) return jsonError(404, `request not found: ${id}`);
  if (detail.request.executionMode === "push" && detail.request.status === "planning") {
    await selectPlansIfReady(db, id);
    const refreshed = await getRequestDetail(db, id);
    if (refreshed) return NextResponse.json(toApiRequest(refreshed));
  }
  return NextResponse.json(toApiRequest(detail));
}
