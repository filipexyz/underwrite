import { NextResponse } from "next/server";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireAdminApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const rows = await listApiKeys(db);
  return NextResponse.json({ keys: rows.map(toPublicApiKey) });
}
