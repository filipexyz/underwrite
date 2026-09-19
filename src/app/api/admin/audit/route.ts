import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { agents, ledgerEvents, wallets } from "@/lib/db/schema";
import { classifyWallet } from "@/lib/marketplace/credits";
import { listRequests } from "@/lib/marketplace/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const [requests, walletRows, events, agentRows] = await Promise.all([
    listRequests(db, 25),
    db.select().from(wallets),
    db.select().from(ledgerEvents).orderBy(desc(ledgerEvents.seq)).limit(40),
    db.select({ agentId: agents.agentId }).from(agents),
  ]);
  const agentIds = new Set(agentRows.map((row) => row.agentId));
  return NextResponse.json({
    requests,
    wallets: walletRows
      .slice()
      .sort((a, b) => b.capitalUsd - a.capitalUsd || a.ownerId.localeCompare(b.ownerId))
      .map((w) => ({
        owner_id: w.ownerId,
        kind: classifyWallet(w.ownerId, agentIds),
        capital_usd: w.capitalUsd,
        risk_tolerance: w.riskTolerance,
        updated_at: w.updatedAt.toISOString(),
      })),
    ledger_head: events.map((e) => ({
      seq: e.seq,
      type: e.type,
      request_id: e.requestId,
      agent_id: e.agentId,
      cost_usd: e.costUsd,
      ts: e.ts,
    })),
  });
}
