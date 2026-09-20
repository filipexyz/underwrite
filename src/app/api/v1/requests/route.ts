/**
 * POST /api/v1/requests — the only entry point (CONTRACTS.md §1).
 *
 * Body: the 4 + 1 fields plus optional `execution_mode` (`seed` | `push`)
 * and optional `invite_agent_ids` (push only — pin the invite set).
 * `seed` (default) kicks the Mastra auction loop after the response (`after()`).
 * `push` holds escrow, invites Top-K (or the requested ids), and waits for one plan+price each.
 * Env `MARKETPLACE_PUSH=1` defaults omitted mode to push; the console demo
 * button always forces seed.
 *
 * `?wait=1` blocks: seed runs the loop to settlement; push invites then
 * waits only through select (delivery is the seller worker).
 */
import { after, NextResponse } from "next/server";
import { RequestInput } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { createRequest, getRequest, getRequestDetail, listRequests, toApiRequest } from "@/lib/marketplace/requests";
import { PushJobError, resolveExecutionMode, selectPlansIfReady, sleep, startPushJob } from "@/lib/marketplace/push";
import { runMarketplace } from "@/mastra";
import { absoluteUrl, authorizeBuyerRequest, inferenceErrorResponse, jsonError, modelProviderUnavailableResponse, requireApiKey } from "@/lib/api/http";
import { buyerWalletOwnerId } from "@/lib/auth/bearer";
import { ensureUserWallet } from "@/lib/marketplace/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jobLinks(request: Request, requestId: string) {
  return {
    self: absoluteUrl(request, `/api/v1/requests/${requestId}`),
    events: absoluteUrl(request, `/api/v1/requests/${requestId}/events`),
    console: absoluteUrl(request, `/console/requests/${requestId}`),
    plans: absoluteUrl(request, `/api/v1/jobs/${requestId}/plans`),
    deliverables: absoluteUrl(request, `/api/v1/jobs/${requestId}/deliverables`),
  };
}

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
  const walletOwner = buyerWalletOwnerId(auth.auth);
  if (walletOwner) {
    const wallet = await ensureUserWallet(db, walletOwner);
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

  const mode = resolveExecutionMode(parsed.data.execution_mode);
  if (parsed.data.invite_agent_ids && parsed.data.invite_agent_ids.length > 0 && mode !== "push") {
    return jsonError(422, "invite_agent_ids requires execution_mode: \"push\"");
  }

  const row = await createRequest(db, parsed.data, { actor: "agent", source: "api", buyerWalletId });
  const wait = new URL(request.url).searchParams.get("wait") === "1";

  if (mode === "push") {
    try {
      const started = await startPushJob(db, row.requestId);
      if (wait) {
        if (!env.isTest) await sleep(env.planWindowMs);
        await selectPlansIfReady(db, row.requestId);
        const detail = await getRequestDetail(db, row.requestId);
        return NextResponse.json(detail ? toApiRequest(detail) : { request_id: row.requestId }, { status: 200 });
      }
      if (!env.isTest) {
        after(async () => {
          try {
            await sleep(env.planWindowMs);
            await selectPlansIfReady(db, row.requestId);
          } catch (error) {
            console.error(`[underwrite] push select for ${row.requestId} crashed:`, error);
          }
        });
      }
      const current = await getRequest(db, row.requestId);
      return NextResponse.json(
        {
          request_id: row.requestId,
          status: current?.status ?? "planning",
          execution_mode: "push",
          plan_deadline_at: started.plan_deadline_at,
          invited_agent_ids: started.invited,
          requested_invite_agent_ids: parsed.data.invite_agent_ids ?? [],
          deliveries: started.deliveries,
          human_interventions: 0,
          links: jobLinks(request, row.requestId),
        },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof PushJobError) return jsonError(error.status, error.message, error.details);
      throw error;
    }
  }

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
      execution_mode: "seed",
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
