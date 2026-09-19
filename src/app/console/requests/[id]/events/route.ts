/**
 * Console-internal ledger feed (Clerk-protected like the rest of /console,
 * never API-key gated). Same shape as /api/v1/requests/[id]/events.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { deriveMetrics, listEvents } from "@/lib/ledger/ledger";
import { getRequest } from "@/lib/marketplace/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getDb();
  const row = await getRequest(db, id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const events = await listEvents(db, id);
  return NextResponse.json({
    request_id: id,
    status: row.status,
    metrics: deriveMetrics(events),
    events: after > 0 ? events.filter((e) => e.seq > after) : events,
  });
}
