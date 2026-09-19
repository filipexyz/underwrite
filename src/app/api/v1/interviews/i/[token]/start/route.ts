/**
 * POST /api/v1/interviews/i/[token]/start — interviewee start.
 * Auth = possession of the invite token. No Clerk.
 */
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { startInterviewForNeed } from "@/lib/interviews/flow";
import { getNeedByToken } from "@/lib/interviews/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { db } = await getDb();
  const need = await getNeedByToken(db, token);
  if (!need) return jsonError(404, "interview link not found");

  const result = await startInterviewForNeed(db, need);
  if (!result.ok) return jsonError(result.status, result.error, result.details);
  return NextResponse.json(result.payload);
}
