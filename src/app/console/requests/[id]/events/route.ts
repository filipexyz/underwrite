/**
 * Console-internal ledger feed. Admin-gated in the handler, not just by the layout: route handlers
 * do not pass through a layout, so the proxy's session check alone would leave every request's
 * ledger readable by any signed-in account.
 */
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { deriveMetrics, listEvents } from "@/lib/ledger/ledger";
import { getRequest } from "@/lib/marketplace/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
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
