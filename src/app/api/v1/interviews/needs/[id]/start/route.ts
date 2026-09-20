/**
 * POST /api/v1/interviews/needs/[id]/start — creator/admin start (Auth0).
 * Interviewees use POST /api/v1/interviews/i/[token]/start instead.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { requireInterviewUser } from "@/lib/interviews/auth";
import { startInterviewForNeed } from "@/lib/interviews/flow";
import { getNeed } from "@/lib/interviews/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInterviewUser();
  if ("error" in actor) return actor.error;

  const { id } = await params;
  const { db } = await getDb();
  const need = await getNeed(db, id);
  if (!need) return jsonError(404, `need not found: ${id}`);

  const result = await startInterviewForNeed(db, need);
  if (!result.ok) return jsonError(result.status, result.error, result.details);
  return NextResponse.json({ ...result.payload, need_id: need.id });
}
