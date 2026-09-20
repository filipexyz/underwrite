/**
 * POST /api/v1/voice/sessions — start a conversation on the signed-in landing.
 *
 * Signed-in only: this surface posts tasks against the caller's wallet, so it is not public the way the
 * interview invite link is.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { startVoiceSession } from "@/lib/voice/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  const { db } = await getDb();
  const result = await startVoiceSession(db, auth.identity.userId);
  if (!result.ok) return jsonError(result.status, result.error, result.details);
  return NextResponse.json(result.payload, { status: 201 });
}
