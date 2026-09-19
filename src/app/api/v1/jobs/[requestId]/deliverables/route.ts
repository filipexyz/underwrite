/**
 * POST /api/v1/jobs/[requestId]/deliverables — seller key, winner only.
 * Body must include worker-produced artifact facts (no platform render).
 * Runs existing verification against the plan promise, then RELEASE or WITHHOLD.
 */
import { NextResponse } from "next/server";
import { JobDeliverableInput } from "@/lib/contracts";
import { jsonError, requireSellerKey } from "@/lib/api/http";
import { getDb } from "@/lib/db/client";
import { getRequest, getRequestDetail, toApiRequest } from "@/lib/marketplace/requests";
import { PushJobError, submitDeliverable } from "@/lib/marketplace/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const auth = await requireSellerKey(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = JobDeliverableInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid deliverable", parsed.error.flatten());

  const { requestId } = await params;
  const { db } = await getDb();
  const row = await getRequest(db, requestId);
  if (!row) return jsonError(404, `job not found: ${requestId}`);

  try {
    await submitDeliverable(db, requestId, auth.agentId, parsed.data);
    const detail = await getRequestDetail(db, requestId);
    return NextResponse.json(detail ? toApiRequest(detail) : { request_id: requestId });
  } catch (error) {
    if (error instanceof PushJobError) return jsonError(error.status, error.message, error.details);
    throw error;
  }
}
