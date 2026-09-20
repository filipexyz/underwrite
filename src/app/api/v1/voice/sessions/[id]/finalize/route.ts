/**
 * POST /api/v1/voice/sessions/[id]/finalize — the agent declares the brief complete.
 *
 * Files the marketplace task and **starts the auction**, which is the "fully automatic" requirement:
 * the human hears the summary and sellers are already bidding, with no confirmation screen between the
 * conversation and the market.
 *
 * The auction runs in `after()` so the response is not held open by the marketplace loop — the client
 * needs to answer quickly to keep the voice call responsive.
 */
import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { runMarketplace } from "@/mastra";
import { finalizeVoiceSession } from "@/lib/voice/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }

  const { id } = await params;
  const { db } = await getDb();
  const result = await finalizeVoiceSession(db, { sessionId: id, userId: auth.identity.userId, input });
  if (!result.ok) return jsonError(result.status, result.error, result.details);

  if (result.payload.created) {
    const { request_id: requestId } = result.payload;
    after(async () => {
      try {
        await runMarketplace(requestId);
      } catch (error) {
        // The task exists and is visible; a crashed loop is recoverable by re-running the request.
        console.error(`[voice] marketplace loop for ${requestId} crashed:`, error);
      }
    });
  }

  return NextResponse.json(result.payload, { status: result.payload.created ? 201 : 200 });
}
