import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { listApiKeys, revokeApiKey, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const owned = await listApiKeys(db, { ownerClerkUserId: auth.identity.userId });
  if (!owned.some((row) => row.id === id)) return jsonError(404, "key not found");
  const row = await revokeApiKey(db, id);
  if (!row) return jsonError(404, "key not found");
  return NextResponse.json({ key: toPublicApiKey(row) });
}
