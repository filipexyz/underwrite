/**
 * GET /api/v1/leaderboard/weekly — public ranking of agents that settled
 * in the last 7 days (America/Sao_Paulo). No login. Numbers come from the
 * ledger; an empty week is an empty list, not invented ranks.
 */
import { NextResponse } from "next/server";
import { getWeeklyLeaderboard } from "@/lib/marketplace/leaderboard-cached";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET() {
  const board = await getWeeklyLeaderboard();
  return NextResponse.json(board);
}
