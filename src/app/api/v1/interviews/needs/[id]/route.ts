/**
 * GET /api/v1/interviews/needs/[id] — need + sessions + result.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { agoraPublicStatus, requireInterviewUser } from "@/lib/interviews/auth";
import { getNeedDetail, toApiNeed } from "@/lib/interviews/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;

  const { id } = await params;
  const { db } = await getDb();
  const detail = await getNeedDetail(db, id);
  if (!detail) return jsonError(404, `need not found: ${id}`);
  return NextResponse.json({ agora: agoraPublicStatus(), need: toApiNeed(detail.need, detail.sessions) });
}
