/**
 * POST /api/v1/jobs/[requestId]/plans — seller key, one plan+price per agent.
 * GET  /api/v1/jobs/[requestId]/plans — buyer key or console (same gate as requests).
 *
 * No reprice. The price in the plan is the price.
 */
import { NextResponse } from "next/server";
import { JobPlanInput } from "@/lib/contracts";
import { authorizeBuyerRequest, jsonError, requireSellerKey } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { getRequest } from "@/lib/marketplace/requests";
import { listJobPlans, PushJobError, selectPlansIfReady, submitSellerPlan } from "@/lib/marketplace/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const denied = await authorizeBuyerRequest(request);
  if (!denied.ok) return denied.response;
  const { requestId } = await params;
  const { db } = await getDb();
  const row = await getRequest(db, requestId);
  if (!row) return jsonError(404, `job not found: ${requestId}`);
  if (row.executionMode === "push") await selectPlansIfReady(db, requestId);
  return NextResponse.json({ job_id: requestId, request_id: requestId, plans: await listJobPlans(db, requestId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const auth = await requireSellerKey(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = JobPlanInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid plan", parsed.error.flatten());

  const { requestId } = await params;
  const { db } = await getDb();
  const row = await getRequest(db, requestId);
  if (!row) return jsonError(404, `job not found: ${requestId}`);

  try {
    const plan = await submitSellerPlan(db, requestId, auth.agentId, parsed.data);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    if (error instanceof PushJobError) return jsonError(error.status, error.message, error.details);
    throw error;
  }
}
