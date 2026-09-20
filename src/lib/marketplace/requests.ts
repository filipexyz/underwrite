/**
 * Request service: the only entry point (CONTRACTS.md §1) and the read views
 * the API and the console share. Metrics are always derived from the ledger.
 */
import { asc, desc, eq } from "drizzle-orm";
import { type LedgerMetrics, type RequestInput, type RequestStatus } from "@/lib/contracts";
import { resolveExecutionMode } from "./push";
import { EMPTY_STATE } from "./types";
import type { Db } from "@/lib/db/client";
import {
  attributions,
  bids,
  escrows,
  ledgerEvents,
  plans,
  requests,
  verifications,
  type AttributionRow,
  type BidRow,
  type EscrowRow,
  type PlanRow,
  type RequestRow,
  type VerificationRow,
} from "@/lib/db/schema";
import { newId, nowMs } from "@/lib/ids";
import { deriveMetrics, listEvents, rowToEvent } from "@/lib/ledger/ledger";
import { defaultRubricFor } from "@/lib/verification/rubric";
import { DEMO_INPUT_HTML } from "./artifact";

export const DEFAULT_CATEGORY = "html_to_pdf";

/** The demo scene's request (README "The demo"). */
export const DEMO_REQUEST: RequestInput = {
  task: {
    requirement: "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
    files: [{ name: "input.html", media_type: "text/html", content: DEMO_INPUT_HTML }],
  },
  max_cost_usd: 0.05,
  max_latency_s: 30,
  min_confidence: 0.95,
  failure_policy: "refund",
  selection_timeout_s: 5,
};

export async function createRequest(
  db: Db,
  input: RequestInput,
  meta: {
    actor?: string;
    source?: string;
    buyerWalletId?: string;
    executionMode?: "seed" | "push";
    category?: string;
  } = {},
): Promise<RequestRow> {
  const requestId = newId("req");
  const category = (input.category ?? meta.category ?? DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
  const verification = input.verification ?? defaultRubricFor(category);
  const executionMode = resolveExecutionMode(input.execution_mode, meta.executionMode);
  const requestedInviteIds = [...new Set((input.invite_agent_ids ?? []).map((id) => id.trim()).filter(Boolean))];
  const [row] = await db
    .insert(requests)
    .values({
      requestId,
      status: "received",
      category,
      requirement: input.task.requirement,
      files: input.task.files,
      maxCostUsd: input.max_cost_usd,
      maxLatencyS: input.max_latency_s,
      minConfidence: input.min_confidence,
      failurePolicy: input.failure_policy,
      selectionTimeoutS: input.selection_timeout_s,
      verification,
      buyerWalletId: meta.buyerWalletId,
      executionMode,
      state: requestedInviteIds.length > 0 ? { ...EMPTY_STATE, requested_invite_agent_ids: requestedInviteIds } : undefined,
    })
    .returning();

  await db.insert(ledgerEvents).values({
    eventId: newId("evt"),
    ts: nowMs(),
    requestId,
    type: "request_received",
    payload: {
      actor: meta.actor ?? "agent",
      source: meta.source ?? "api",
      requirement: input.task.requirement,
      files: input.task.files.map((f) => ({ name: f.name, media_type: f.media_type, bytes: f.content.length })),
      max_cost_usd: input.max_cost_usd,
      max_latency_s: input.max_latency_s,
      min_confidence: input.min_confidence,
      failure_policy: input.failure_policy,
      selection_timeout_s: input.selection_timeout_s,
      rubric_version: verification.rubric_version,
      buyer_wallet_id: meta.buyerWalletId ?? null,
      execution_mode: executionMode,
      invite_agent_ids: requestedInviteIds,
    },
  });
  return row;
}

export async function getRequest(db: Db, requestId: string): Promise<RequestRow | null> {
  const [row] = await db.select().from(requests).where(eq(requests.requestId, requestId));
  return row ?? null;
}

export type RequestSummary = {
  request_id: string;
  status: RequestStatus;
  execution_mode: string;
  requirement: string;
  max_cost_usd: number;
  max_latency_s: number;
  min_confidence: number;
  created_at: string;
  completed_at: string | null;
  delivered_confidence: number | null;
  total_cost_usd: number | null;
  escalations: number;
};

export async function listRequests(db: Db, limit = 50): Promise<RequestSummary[]> {
  const rows = await db.select().from(requests).orderBy(desc(requests.createdAt)).limit(limit);
  return rows.map((r) => {
    const outcome = (r.outcome ?? {}) as { certificate?: { delivered_confidence?: number }; metrics?: LedgerMetrics };
    return {
      request_id: r.requestId,
      status: r.status as RequestStatus,
      execution_mode: r.executionMode,
      requirement: r.requirement,
      max_cost_usd: r.maxCostUsd,
      max_latency_s: r.maxLatencyS,
      min_confidence: r.minConfidence,
      created_at: r.createdAt.toISOString(),
      completed_at: r.completedAt?.toISOString() ?? null,
      delivered_confidence: outcome.certificate?.delivered_confidence ?? null,
      total_cost_usd: outcome.metrics?.total_cost_usd ?? null,
      escalations: r.state?.escalations ?? 0,
    };
  });
}

export type RequestDetail = {
  request: RequestRow;
  metrics: LedgerMetrics;
  events: ReturnType<typeof rowToEvent>[];
  bids: BidRow[];
  plans: PlanRow[];
  escrows: EscrowRow[];
  verifications: VerificationRow[];
  attributions: AttributionRow[];
};

export async function getRequestDetail(db: Db, requestId: string): Promise<RequestDetail | null> {
  const request = await getRequest(db, requestId);
  if (!request) return null;
  const [events, bidRows, planRows, escrowRows, verificationRows, attributionRows] = await Promise.all([
    listEvents(db, requestId),
    db.select().from(bids).where(eq(bids.requestId, requestId)).orderBy(asc(bids.createdAt)),
    db.select().from(plans).where(eq(plans.requestId, requestId)).orderBy(asc(plans.createdAt)),
    db.select().from(escrows).where(eq(escrows.requestId, requestId)).orderBy(asc(escrows.createdAt)),
    db.select().from(verifications).where(eq(verifications.requestId, requestId)).orderBy(asc(verifications.createdAt)),
    db.select().from(attributions).where(eq(attributions.requestId, requestId)).orderBy(asc(attributions.createdAt)),
  ]);
  return {
    request,
    metrics: deriveMetrics(events),
    events,
    bids: bidRows,
    plans: planRows,
    escrows: escrowRows,
    verifications: verificationRows,
    attributions: attributionRows,
  };
}

/** Public shape of `GET /api/v1/requests/[id]`. */
export function toApiRequest(detail: RequestDetail) {
  const r = detail.request;
  return {
    request_id: r.requestId,
    status: r.status,
    category: r.category,
    execution_mode: r.executionMode,
    plan_deadline_at: r.planDeadlineAt?.toISOString() ?? r.state?.plan_deadline_at ?? null,
    invited_agent_ids: r.state?.invited_agent_ids ?? [],
    requested_invite_agent_ids: r.state?.requested_invite_agent_ids ?? [],
    task: { requirement: r.requirement, files: r.files.map((f) => ({ name: f.name, media_type: f.media_type, bytes: f.content.length })) },
    max_cost_usd: r.maxCostUsd,
    max_latency_s: r.maxLatencyS,
    min_confidence: r.minConfidence,
    failure_policy: r.failurePolicy,
    buyer_wallet_id: r.buyerWalletId,
    selection_timeout_s: r.selectionTimeoutS,
    verification_spec: r.verification,
    outcome: r.outcome,
    error: r.error,
    workflow_run_id: r.workflowRunId,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    completed_at: r.completedAt?.toISOString() ?? null,
    human_interventions: detail.metrics.human_interventions,
    metrics: detail.metrics,
    chain: (r.state?.hops ?? []).map((h) => ({
      hop_index: h.hop_index,
      agent_id: h.agent_id,
      hirer_id: h.hirer_id,
      plan_id: h.plan_id,
      escrow_id: h.escrow_id,
      price_usd: h.price_usd,
      promised_confidence: h.promised_confidence,
      floor: h.floor,
      specialty: h.specialty,
    })),
    bids: detail.bids.map((b) => ({
      bid_id: b.bidId,
      agent_id: b.agentId,
      confidence: b.confidence,
      cost_usd: b.costUsd,
      latency_s: b.latencyS,
      chain: b.chain,
      rationale: b.rationale,
      trust_global_snapshot: b.trustGlobalSnapshot,
      counter_of: b.counterOf,
      strategy_chosen: b.strategyChosen,
      compliant: b.compliant,
      rejection_reason: b.rejectionReason,
      selected: b.selected,
    })),
    plans: detail.plans.map((p) => ({
      plan_id: p.planId,
      agent_id: p.agentId,
      parent_plan_id: p.parentPlanId,
      supersedes_plan_id: p.supersedesPlanId,
      deliverable: p.deliverable,
      promised_confidence: p.promisedConfidence,
      max_cost_usd: p.maxCostUsd,
      est_latency_s: p.estLatencyS,
      chain: p.chain,
      rationale: p.rationale,
      plan_cost_usd: p.planCostUsd,
      stake_usd: p.stakeUsd,
      strategy_considered: p.strategyConsidered,
      strategy_chosen: p.strategyChosen,
      status: p.status,
      rejection_reason: p.rejectionReason,
    })),
    escrows: detail.escrows.map((e) => ({
      escrow_id: e.escrowId,
      plan_id: e.planId,
      hop_index: e.hopIndex,
      payer_agent_id: e.payerAgentId,
      payee_agent_id: e.payeeAgentId,
      amount_usd: e.amountUsd,
      stake_usd: e.stakeUsd,
      min_confidence: e.minConfidence,
      status: e.status,
      resolved_at: e.resolvedAt?.toISOString() ?? null,
    })),
    verifications: detail.verifications.map((v) => ({
      verification_id: v.verificationId,
      plan_id: v.planId,
      producer_agent_id: v.producerAgentId,
      artifact_ref: v.artifactRef,
      checks: v.checks,
      confidence: v.confidence,
      verdict: v.verdict,
      judges: v.judges,
      judges_disagree: v.judgesDisagree,
    })),
    attributions: detail.attributions.map((a) => ({
      attribution_id: a.attributionId,
      failed_hop: a.failedHop,
      root_cause: a.rootCause,
      blamed_agent: a.blamedAgent,
      evidence_event_ids: a.evidenceEventIds,
      explanation: a.explanation,
    })),
    events: detail.events,
  };
}

export type ApiRequest = ReturnType<typeof toApiRequest>;
