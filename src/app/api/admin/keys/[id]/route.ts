import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { revokeApiKey, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireAdminApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const row = await revokeApiKey(db, id);
  if (!row) return jsonError(404, "key not found");
  return NextResponse.json({ key: toPublicApiKey(row) });
}
