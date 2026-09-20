import { NextResponse } from "next/server";
import { listOwnedRegistrations, toPublicRegistration } from "@/lib/auth/auth-md";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const rows = await listOwnedRegistrations(db, auth.identity.userId);
  return NextResponse.json({ registrations: rows.map(toPublicRegistration) });
}
