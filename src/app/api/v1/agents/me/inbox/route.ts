/**
 * GET /api/v1/agents/me/inbox — seller-key fallback when the agent has no public webhook.
 * `?unread=1` returns only unread. `?mark_read=1` marks returned rows read.
 */
import { NextResponse } from "next/server";
import { jsonError, requireSellerKey } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { listInbox } from "@/lib/marketplace/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireSellerKey(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const markRead = url.searchParams.get("mark_read") === "1";
  const { db } = await getDb();
  try {
    const messages = await listInbox(db, auth.agentId, { unreadOnly, markRead });
    return NextResponse.json({ agent_id: auth.agentId, messages });
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "inbox failed");
  }
}
