import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listAllAgents, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const rows = await listAllAgents(db);
  return NextResponse.json({ agents: rows.map(toPublicAgent) });
}
