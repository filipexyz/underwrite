/**
 * GET /api/v1/interviews/i/[token] — public invite lookup.
 * Auth is possession of the unguessable token. No Clerk.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { agoraPublicStatus } from "@/lib/interviews/auth";
import { getNeedByToken, toPublicNeed } from "@/lib/interviews/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { db } = await getDb();
  const need = await getNeedByToken(db, token);
  if (!need) return jsonError(404, "interview link not found");
  return NextResponse.json({ agora: agoraPublicStatus(), interview: toPublicNeed(need) });
}
