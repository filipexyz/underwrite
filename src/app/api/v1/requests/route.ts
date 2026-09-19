/**
 * POST /api/v1/requests — the only entry point (CONTRACTS.md §1).
 *
 * Body: the 4 + 1 fields (`task`, `max_cost_usd`, `max_latency_s`,
 * `min_confidence`, `failure_policy`) plus optional `selection_timeout_s` and
 * `verification` rubric. Creates the Request, logs `request_received`, and
 * kicks the Mastra workflow after the response is sent (`after()`).
 *
 * `?wait=1` runs the loop before responding — handy for scripts and demos.
 *
 * GET /api/v1/requests — recent requests (summary).
 */
import { after, NextResponse } from "next/server";
import { RequestInput } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import { createRequest, getRequestDetail, listRequests, toApiRequest } from "@/lib/marketplace/requests";
import { runMarketplace } from "@/mastra";
import { absoluteUrl, authorizeBuyerRequest, inferenceErrorResponse, jsonError, modelProviderUnavailableResponse, requireApiKey } from "@/lib/api/http";
import { ensureUserWallet } from "@/lib/marketplace/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await authorizeBuyerRequest(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = RequestInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid request", parsed.error.flatten());

  const { db } = await getDb();
  let buyerWalletId: string | undefined;
  if (auth.auth.kind === "key" && auth.auth.key.ownerClerkUserId) {
    const wallet = await ensureUserWallet(db, auth.auth.key.ownerClerkUserId);
    if (wallet.capitalUsd < parsed.data.max_cost_usd) {
      return jsonError(402, "insufficient wallet balance", {
        owner_id: wallet.ownerId,
        balance_usd: wallet.capitalUsd,
        required_usd: parsed.data.max_cost_usd,
      });
    }
    buyerWalletId = wallet.ownerId;
  }

  const providerDenied = modelProviderUnavailableResponse();
  if (providerDenied) return providerDenied;

  const row = await createRequest(db, parsed.data, { actor: "agent", source: "api", buyerWalletId });
  const wait = new URL(request.url).searchParams.get("wait") === "1";

  if (wait) {
    try {
      const outcome = await runMarketplace(row.requestId);
      if (outcome.status === "failed") {
        const mapped = inferenceErrorResponse(outcome.error);
        if (mapped) return mapped;
      }
    } catch (error) {
      const mapped = inferenceErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
    const detail = await getRequestDetail(db, row.requestId);
    return NextResponse.json(detail ? toApiRequest(detail) : { request_id: row.requestId }, { status: 200 });
  }

  after(async () => {
    try {
      await runMarketplace(row.requestId);
    } catch (error) {
      console.error(`[underwrite] workflow for ${row.requestId} crashed:`, error);
    }
  });

  return NextResponse.json(
    {
      request_id: row.requestId,
      status: row.status,
      human_interventions: 0,
      links: {
        self: absoluteUrl(request, `/api/v1/requests/${row.requestId}`),
        events: absoluteUrl(request, `/api/v1/requests/${row.requestId}/events`),
        console: absoluteUrl(request, `/console/requests/${row.requestId}`),
      },
    },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const denied = await requireApiKey(request);
  if (denied) return denied;
  const { db } = await getDb();
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50, 200);
  return NextResponse.json({ requests: await listRequests(db, limit) });
}
