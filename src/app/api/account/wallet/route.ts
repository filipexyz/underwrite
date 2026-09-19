import { NextResponse } from "next/server";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { STARTING_TEST_CREDITS_USD, ensureWallet } from "@/lib/marketplace/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { db } = await getDb();
  const wallet = await ensureWallet(db, auth.identity.userId, STARTING_TEST_CREDITS_USD);
  return NextResponse.json({
    owner_id: wallet.ownerId,
    balance_usd: wallet.capitalUsd,
    starting_credits_usd: STARTING_TEST_CREDITS_USD,
    currency: "USD",
    note: "test credits — no real money",
  });
}
