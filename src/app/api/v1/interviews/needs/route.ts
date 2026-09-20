/**
 * POST /api/v1/interviews/needs — register a structured interview need.
 * GET  /api/v1/interviews/needs — list (newest first).
 *
 * Auth0 session when configured; open in local-dev. Does not use
 * UNDERWRITE_API_KEY (marketplace agent key).
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { agoraPublicStatus, requireInterviewUser } from "@/lib/interviews/auth";
import { createNeed, listNeeds, toApiNeed } from "@/lib/interviews/store";
import { CreateNeedInput } from "@/lib/interviews/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;

  const { db } = await getDb();
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50, 200);
  const rows = await listNeeds(db, limit);
  return NextResponse.json({ agora: agoraPublicStatus(), needs: rows.map((row) => toApiNeed(row)) });
}

export async function POST(request: Request) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = CreateNeedInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid need", parsed.error.flatten());

  const { db } = await getDb();
  const row = await createNeed(db, parsed.data, actor.userId);
  return NextResponse.json({ agora: agoraPublicStatus(), need: toApiNeed(row) }, { status: 201 });
}
