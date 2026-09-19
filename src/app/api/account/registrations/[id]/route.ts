import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getRegistration, revokeRegistration, toPublicRegistration } from "@/lib/auth/auth-md";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const row = await getRegistration(db, id);
  if (!row || row.ownerUserId !== auth.identity.userId) return jsonError(404, "registration not found");
  const revoked = await revokeRegistration(db, id);
  return NextResponse.json({ registration: revoked ? toPublicRegistration(revoked) : null });
}
