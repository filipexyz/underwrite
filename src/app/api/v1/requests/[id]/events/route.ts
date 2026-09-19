/**
 * GET /api/v1/requests/[id]/events — the append-only ledger for one request.
 *
 * `?after=<seq>` returns only events with a higher `seq`, which is how the
 * console streams the ledger live without a socket.
 */
import { NextResponse } from "next/server";
import { jsonError, requireApiKey } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { deriveMetrics, listEvents } from "@/lib/ledger/ledger";
import { getRequest } from "@/lib/marketplace/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  const { db } = await getDb();
  const row = await getRequest(db, id);
  if (!row) return jsonError(404, `request not found: ${id}`);

  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const events = await listEvents(db, id);
  const metrics = deriveMetrics(events);
  return NextResponse.json({
    request_id: id,
    status: row.status,
    metrics,
    human_interventions: metrics.human_interventions,
    events: after > 0 ? events.filter((e) => e.seq > after) : events,
  });
}
