/**
 * Locked marketplace PoC (no reprice).
 *
 *   hold → discover Top-K → push plan_request → one plan+price →
 *   best-score select → lock escrow → accepted/rejected → deliver →
 *   judge vs PLAN → RELEASE | WITHHOLD
 *
 * Agents receive work (webhook or inbox). They do not poll the job board
 * as the primary path. The seed Mastra loop is untouched.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { AgentRole, JobDeliverableInput, JobPlanInput } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import {
  agentInbox,
  jobInvites,
  plans,
  requests,
  type AgentInboxRow,
  type InboxMessageType,
  type PlanRow,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { inspectArtifact } from "@/lib/verification/inspect";
import type { PdfArtifact } from "./artifact";
import { buildContext, RULES, setRequestStatus, type EngineContext } from "./context";
import { finalizeRequest, verifyDelivery, settleChain } from "./engine";
import {
  createLockedEscrowFromHold,
  holdBuyerBudget,
  InsufficientHoldError,
  refundBuyerHold,
} from "./escrow";
import { discover, getAgent, type RegistryAgent } from "./registry";
import { round6, stakeFor } from "./quotes";
import { defaultHistory, rankPlans, type ScoreConstraints } from "./score";
import { EMPTY_STATE, type EngineState, type HopRecord } from "./types";
import { postSellerWebhook } from "./webhooks";

const EPS = 1e-9;

export class PushJobError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function getState(ctx: EngineContext): EngineState {
  return { ...EMPTY_STATE, ...(ctx.request.state ?? {}) };
}

async function saveState(ctx: EngineContext, state: EngineState): Promise<void> {
  await ctx.db
    .update(requests)
    .set({ state, updatedAt: new Date() })
    .where(eq(requests.requestId, ctx.request.requestId));
  ctx.request = { ...ctx.request, state };
}

function constraintsOf(ctx: EngineContext): ScoreConstraints {
  return {
    max_cost_usd: ctx.request.maxCostUsd,
    max_latency_s: ctx.request.maxLatencyS,
    min_confidence: ctx.request.minConfidence,
  };
}

export function resolveExecutionMode(input?: "seed" | "push" | null, forced?: "seed" | "push" | null): "seed" | "push" {
  if (forced === "seed" || forced === "push") return forced;
  if (input === "seed" || input === "push") return input;
  return env.marketplacePush ? "push" : "seed";
}

export function discoverTopK(
  registry: EngineContext["registry"],
  specialty: string,
  k = env.marketplaceTopK,
): RegistryAgent[] {
  return discover(registry, { specialty })
    .sort((a, b) => {
      const aw = a.webhookUrl ? 1 : 0;
      const bw = b.webhookUrl ? 1 : 0;
      if (bw !== aw) return bw - aw;
      return b.trust_global - a.trust_global || a.agentId.localeCompare(b.agentId);
    })
    .slice(0, k);
}

function briefPayload(ctx: EngineContext, planDeadlineAt: Date) {
  return {
    type: "plan_request" as const,
    job_id: ctx.request.requestId,
    request_id: ctx.request.requestId,
    brief: {
      requirement: ctx.request.requirement,
      files: ctx.request.files.map((f) => ({
        name: f.name,
        media_type: f.media_type,
        bytes: f.content.length,
        content: f.content,
      })),
    },
    constraints: {
      max_cost_usd: ctx.request.maxCostUsd,
      max_latency_s: ctx.request.maxLatencyS,
      min_confidence: ctx.request.minConfidence,
      category: ctx.request.category,
    },
    plan_deadline_at: planDeadlineAt.toISOString(),
  };
}

async function enqueueInbox(
  ctx: EngineContext,
  agentId: string,
  type: InboxMessageType,
  payload: Record<string, unknown>,
  deliveredVia: string,
): Promise<AgentInboxRow> {
  const [row] = await ctx.db
    .insert(agentInbox)
    .values({
      inboxId: newId("inbox"),
      agentId,
      requestId: ctx.request.requestId,
      type,
      payload,
      deliveredVia,
    })
    .returning();
  return row;
}

async function notifyAgent(
  ctx: EngineContext,
  agent: RegistryAgent,
  payload: Record<string, unknown> & { type: InboxMessageType },
): Promise<{ channel: "webhook" | "inbox"; webhook_ok: boolean | null }> {
  if (agent.webhookUrl) {
    const result = await postSellerWebhook(agent.webhookUrl, payload, agent.agentId);
    if (result.ok) {
      await enqueueInbox(ctx, agent.agentId, payload.type, payload, "webhook");
      return { channel: "webhook", webhook_ok: true };
    }
    await enqueueInbox(ctx, agent.agentId, payload.type, { ...payload, webhook_error: result.error }, "inbox");
    return { channel: "inbox", webhook_ok: false };
  }
  await enqueueInbox(ctx, agent.agentId, payload.type, payload, "inbox");
  return { channel: "inbox", webhook_ok: null };
}

export async function startPushJob(db: Db, requestId: string): Promise<{ invited: string[]; plan_deadline_at: string }> {
  const ctx = await buildContext(db, requestId);
  if (ctx.request.executionMode !== "push") {
    throw new PushJobError(409, "request is not a push job", { execution_mode: ctx.request.executionMode });
  }
  const existing = getState(ctx);
  if (existing.invited_agent_ids && existing.invited_agent_ids.length > 0) {
    return {
      invited: existing.invited_agent_ids,
      plan_deadline_at: existing.plan_deadline_at ?? ctx.request.planDeadlineAt?.toISOString() ?? "",
    };
  }
  if (ctx.request.status !== "received") {
    throw new PushJobError(409, `cannot invite from status ${ctx.request.status}`);
  }

  try {
    await holdBuyerBudget(ctx, ctx.request.maxCostUsd);
  } catch (error) {
    if (error instanceof InsufficientHoldError) {
      await setRequestStatus(ctx, "failed", {
        error: error.message,
        completedAt: new Date(),
        outcome: { reason: "insufficient_hold", required_usd: error.requiredUsd, balance_usd: error.balanceUsd },
      });
      throw new PushJobError(402, "insufficient wallet balance", {
        owner_id: error.ownerId,
        balance_usd: error.balanceUsd,
        required_usd: error.requiredUsd,
      });
    }
    throw error;
  }

  const invited = discoverTopK(ctx.registry, ctx.request.category);
  const deadline = new Date(Date.now() + env.planWindowMs);

  if (invited.length === 0) {
    await refundBuyerHold(ctx, ctx.request.maxCostUsd, `escrow_hold_refund:${requestId}:no_invitees`);
    await saveState(ctx, {
      ...EMPTY_STATE,
      execution_mode: "push",
      hold_usd: 0,
      settled: true,
    });
    await setRequestStatus(ctx, "no_eligible_plan", {
      completedAt: new Date(),
      outcome: { reason: "no hireable agents matched the specialty" },
    });
    return { invited: [], plan_deadline_at: deadline.toISOString() };
  }

  const payload = briefPayload(ctx, deadline);
  const invitedIds: string[] = [];

  for (const agent of invited) {
    const delivery = await notifyAgent(ctx, agent, payload);
    await ctx.db.insert(jobInvites).values({
      inviteId: newId("inv"),
      requestId,
      agentId: agent.agentId,
      channel: delivery.channel,
      status: "invited",
    });
    invitedIds.push(agent.agentId);
    await ctx.ledger.append({
      type: "plan_request",
      agent_id: agent.agentId,
      payload: {
        job_id: requestId,
        channel: delivery.channel,
        webhook_ok: delivery.webhook_ok,
        plan_deadline_at: deadline.toISOString(),
        constraints: payload.constraints,
      },
    });
  }

  await ctx.db
    .update(requests)
    .set({ planDeadlineAt: deadline, updatedAt: new Date() })
    .where(eq(requests.requestId, requestId));
  ctx.request = { ...ctx.request, planDeadlineAt: deadline };

  await saveState(ctx, {
    ...EMPTY_STATE,
    execution_mode: "push",
    invited_agent_ids: invitedIds,
    plan_deadline_at: deadline.toISOString(),
    hold_usd: ctx.request.maxCostUsd,
  });
  await setRequestStatus(ctx, "planning");
  return { invited: invitedIds, plan_deadline_at: deadline.toISOString() };
}

function approachText(input: JobPlanInput): string {
  if (input.rationale?.trim()) return input.rationale.trim();
  if (input.approach?.trim()) return input.approach.trim();
  if (Array.isArray(input.steps)) return input.steps.join(" → ");
  if (typeof input.steps === "string" && input.steps.trim()) return input.steps.trim();
  return "Execute the requested deliverable at the declared price, confidence and latency.";
}

export function toPublicPlan(row: PlanRow) {
  return {
    plan_id: row.planId,
    request_id: row.requestId,
    job_id: row.requestId,
    agent_id: row.agentId,
    deliverable: row.deliverable,
    promised_confidence: row.promisedConfidence,
    price_usd: row.maxCostUsd,
    max_cost_usd: row.maxCostUsd,
    max_latency_s: row.estLatencyS,
    est_latency_s: row.estLatencyS,
    chain: row.chain,
    rationale: row.rationale,
    stake_usd: row.stakeUsd,
    strategy_chosen: row.strategyChosen,
    status: row.status,
    rejection_reason: row.rejectionReason,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listJobPlans(db: Db, requestId: string) {
  const rows = await db.select().from(plans).where(eq(plans.requestId, requestId)).orderBy(asc(plans.createdAt));
  return rows.map(toPublicPlan);
}

export async function submitSellerPlan(
  db: Db,
  requestId: string,
  agentId: string,
  input: JobPlanInput,
): Promise<ReturnType<typeof toPublicPlan>> {
  const ctx = await buildContext(db, requestId);
  if (ctx.request.executionMode !== "push") {
    throw new PushJobError(409, "plans are only accepted on push jobs");
  }
  await selectPlansIfReady(db, requestId);
  const fresh = await buildContext(db, requestId);
  Object.assign(ctx, fresh);

  if (ctx.request.status !== "planning") {
    throw new PushJobError(409, `plan window is closed (status=${ctx.request.status})`);
  }

  const [invite] = await ctx.db
    .select()
    .from(jobInvites)
    .where(and(eq(jobInvites.requestId, requestId), eq(jobInvites.agentId, agentId)))
    .limit(1);
  if (!invite) throw new PushJobError(403, "this agent was not invited to the job");

  const existing = await ctx.db
    .select()
    .from(plans)
    .where(and(eq(plans.requestId, requestId), eq(plans.agentId, agentId), isNull(plans.parentPlanId)));
  if (existing.length > 0) {
    throw new PushJobError(409, "one plan per agent per job", { plan_id: existing[0].planId });
  }

  const agent = getAgent(ctx.registry, agentId);
  const rationale = approachText(input);
  const deliverable = input.deliverable?.trim() || rationale;
  const buyerPrice = round6(input.price_usd);
  const share = round6(buyerPrice / (1 + RULES.COMMISSION_RATE));
  const chain = input.chain?.length
    ? input.chain
    : [
        {
          agent_id: agentId,
          role: agent.role as AgentRole,
          subtask: deliverable,
          cost_usd: share,
        },
      ];

  const rejection = (() => {
    const reasons: string[] = [];
    if (buyerPrice > ctx.request.maxCostUsd + EPS) reasons.push(`price $${buyerPrice} > max $${ctx.request.maxCostUsd}`);
    if (input.max_latency_s > ctx.request.maxLatencyS + EPS) {
      reasons.push(`latency ${input.max_latency_s}s > ${ctx.request.maxLatencyS}s`);
    }
    if (input.promised_confidence < ctx.request.minConfidence - EPS) {
      reasons.push(`confidence ${input.promised_confidence} < ${ctx.request.minConfidence}`);
    }
    return reasons;
  })();

  const [row] = await ctx.db
    .insert(plans)
    .values({
      planId: newId("plan"),
      requestId,
      agentId,
      parentPlanId: null,
      supersedesPlanId: null,
      deliverable,
      promisedConfidence: input.promised_confidence,
      maxCostUsd: buyerPrice,
      estLatencyS: input.max_latency_s,
      chain,
      rationale,
      planCostUsd: 0,
      stakeUsd: stakeFor(buyerPrice),
      strategyConsidered: ["self"],
      strategyChosen: "self",
      status: rejection.length ? "rejected" : "generated",
      rejectionReason: rejection.length ? rejection.join("; ") : null,
    })
    .returning();

  await ctx.db
    .update(jobInvites)
    .set({ status: "planned" })
    .where(and(eq(jobInvites.requestId, requestId), eq(jobInvites.agentId, agentId)));

  await ctx.ledger.append({
    type: "plan_generated",
    agent_id: agentId,
    payload: {
      plan_id: row.planId,
      job_id: requestId,
      price_usd: buyerPrice,
      promised_confidence: input.promised_confidence,
      max_latency_s: input.max_latency_s,
      chain,
      rationale,
      compliant: rejection.length === 0,
      rejection_reason: row.rejectionReason,
    },
  });
  if (rejection.length) {
    await ctx.ledger.append({
      type: "plan_rejected",
      agent_id: agentId,
      payload: { plan_id: row.planId, reasons: rejection, constraints: constraintsOf(ctx) },
    });
  } else {
    await ctx.ledger.append({
      type: "plan_validated",
      agent_id: agentId,
      payload: { plan_id: row.planId, constraints: constraintsOf(ctx) },
    });
  }

  await selectPlansIfReady(db, requestId);
  return toPublicPlan(row);
}

export async function selectPlansIfReady(
  db: Db,
  requestId: string,
  opts: { force?: boolean } = {},
): Promise<{ selected: boolean; winner_agent_id?: string }> {
  const ctx = await buildContext(db, requestId);
  if (ctx.request.executionMode !== "push" || ctx.request.status !== "planning") {
    return { selected: false };
  }

  const invites = await ctx.db.select().from(jobInvites).where(eq(jobInvites.requestId, requestId));
  const planRows = await ctx.db
    .select()
    .from(plans)
    .where(and(eq(plans.requestId, requestId), isNull(plans.parentPlanId)));
  const plannedAgents = new Set(planRows.map((p) => p.agentId));
  const allResponded = invites.length > 0 && invites.every((i) => plannedAgents.has(i.agentId));
  const deadline = ctx.request.planDeadlineAt ?? (getState(ctx).plan_deadline_at ? new Date(getState(ctx).plan_deadline_at as string) : null);
  const timedOut = deadline ? Date.now() >= deadline.getTime() : false;

  if (!opts.force && !allResponded && !timedOut) return { selected: false };

  const scored = planRows.map((row) => {
    const agent = ctx.registry.agents.get(row.agentId);
    return {
      row,
      price_usd: row.maxCostUsd,
      promised_confidence: row.promisedConfidence,
      latency_s: row.estLatencyS,
      history: defaultHistory(agent?.trust_global),
    };
  });
  const { ranked, winner } = rankPlans(scored, constraintsOf(ctx));

  await ctx.ledger.append({
    type: "plan_selected",
    agent_id: winner?.item.row.agentId ?? null,
    payload: {
      job_id: requestId,
      rule: "best-score (confidence, cost, latency, history) — not cheapest-only",
      reason: opts.force ? "force" : allResponded ? "all_invited_responded" : "plan_window_closed",
      weights: { confidence: 0.4, cost: 0.25, latency: 0.2, history: 0.15 },
      candidates: ranked.map((r) => ({
        agent_id: r.item.row.agentId,
        plan_id: r.item.row.planId,
        score: r.breakdown.score,
        parts: r.breakdown.parts,
        compliant: r.breakdown.compliant,
        price_usd: r.item.price_usd,
        promised_confidence: r.item.promised_confidence,
        latency_s: r.item.latency_s,
      })),
    },
  });

  if (!winner) {
    const hold = getState(ctx).hold_usd ?? ctx.request.maxCostUsd;
    await refundBuyerHold(ctx, hold, `escrow_hold_refund:${requestId}:no_eligible_plan`);
    await saveState(ctx, { ...getState(ctx), hold_usd: 0, settled: true });
    await setRequestStatus(ctx, "no_eligible_plan", {
      completedAt: new Date(),
      outcome: {
        reason: "no submitted plan met confidence ≥ min, latency ≤ max and price ≤ max_cost_usd",
        candidates: ranked.map((r) => ({
          agent_id: r.item.row.agentId,
          rejection: r.breakdown.rejection_reason,
        })),
      },
    });
    return { selected: true };
  }

  const win = winner.item.row;
  const winAgent = getAgent(ctx.registry, win.agentId);
  const buyerPrice = win.maxCostUsd;
  const shares = round6(buyerPrice / (1 + RULES.COMMISSION_RATE));
  const hold = getState(ctx).hold_usd ?? ctx.request.maxCostUsd;

  await ctx.db.update(plans).set({ status: "validated", rejectionReason: null }).where(eq(plans.planId, win.planId));
  for (const other of planRows.filter((p) => p.planId !== win.planId)) {
    await ctx.db
      .update(plans)
      .set({
        status: "rejected",
        rejectionReason: other.rejectionReason ?? "not selected (best-score)",
      })
      .where(eq(plans.planId, other.planId));
  }

  const escrow = await createLockedEscrowFromHold(ctx, {
    plan_id: win.planId,
    hop_index: 0,
    payer_agent_id: null,
    payee_agent_id: win.agentId,
    amount_usd: buyerPrice,
    min_confidence: ctx.request.minConfidence,
    hold_usd: hold,
    stake_usd: stakeFor(buyerPrice),
    payload: { promised_confidence: win.promisedConfidence, selection: "best-score" },
  });

  const hop: HopRecord = {
    hop_index: 0,
    agent_id: win.agentId,
    role: winAgent.role as AgentRole,
    hirer_id: null,
    plan_id: win.planId,
    escrow_id: escrow.escrowId,
    price_usd: shares,
    own_cost_usd: shares,
    promised_confidence: win.promisedConfidence,
    floor: ctx.request.minConfidence,
    own_latency_s: win.estLatencyS,
    est_latency_s: win.estLatencyS,
    deadline_s: ctx.request.maxLatencyS,
    strategy: "self",
    subtask: win.deliverable,
    specialty: ctx.request.category,
    selection: {
      specialty: ctx.request.category,
      policy: "cheapest_trusted",
      history_checked: true,
      floor: win.promisedConfidence,
      candidates: ranked.map((r) => ({
        agent_id: r.item.row.agentId,
        price_usd: r.item.price_usd,
        promised_confidence: r.item.promised_confidence,
        latency_s: r.item.latency_s,
        trust_global: r.item.history,
        execution: ctx.registry.agents.get(r.item.row.agentId)?.axes.execution ?? null,
        underwriting: ctx.registry.agents.get(r.item.row.agentId)?.axes.underwriting ?? null,
        pairwise: null,
        eligible: r.breakdown.compliant,
        reason: r.breakdown.rejection_reason,
      })),
      chosen: win.agentId,
      price_vs_market: null,
      rationale: `best-score ${winner.breakdown.score} (conf ${winner.breakdown.parts.confidence}, cost ${winner.breakdown.parts.cost}, latency ${winner.breakdown.parts.latency}, hist ${winner.breakdown.parts.history})`,
    },
  };

  await ctx.ledger.append({
    type: "agent_hired",
    agent_id: win.agentId,
    payload: {
      hirer: "buyer",
      plan_id: win.planId,
      rule: "best-score (confidence, cost, latency, history) — not cheapest-only",
      selected_by: "marketplace_policy",
      cost_usd: buyerPrice,
      confidence: win.promisedConfidence,
      latency_s: win.estLatencyS,
      score: winner.breakdown.score,
    },
  });
  await ctx.ledger.append({
    type: "task_delegated",
    payload: {
      from: "buyer",
      to: win.agentId,
      hop_index: 0,
      subtask: win.deliverable,
      specialty: ctx.request.category,
      floor: win.promisedConfidence,
      price_usd: buyerPrice,
      deadline_s: ctx.request.maxLatencyS,
      plan_id: win.planId,
      execute: true,
    },
  });

  await saveState(ctx, {
    ...getState(ctx),
    hops: [hop],
    selected_plan_id: win.planId,
    hold_usd: buyerPrice,
    attempt: 1,
    pending_latency_s: win.estLatencyS,
  });
  await setRequestStatus(ctx, "executing");

  const acceptedPayload = {
    type: "accepted" as const,
    job_id: requestId,
    request_id: requestId,
    plan_id: win.planId,
    execute: true,
    price_usd: buyerPrice,
    promised_confidence: win.promisedConfidence,
    constraints: constraintsOf(ctx),
  };
  await notifyAgent(ctx, winAgent, acceptedPayload);
  await ctx.db
    .update(jobInvites)
    .set({ status: "accepted" })
    .where(and(eq(jobInvites.requestId, requestId), eq(jobInvites.agentId, win.agentId)));

  for (const other of planRows.filter((p) => p.planId !== win.planId)) {
    const otherAgent = ctx.registry.agents.get(other.agentId);
    const rejectedPayload = {
      type: "rejected" as const,
      job_id: requestId,
      request_id: requestId,
      plan_id: other.planId,
      reason: other.rejectionReason ?? "not selected (best-score)",
    };
    if (otherAgent) await notifyAgent(ctx, otherAgent, rejectedPayload);
    await ctx.db
      .update(jobInvites)
      .set({ status: "rejected" })
      .where(and(eq(jobInvites.requestId, requestId), eq(jobInvites.agentId, other.agentId)));
  }

  for (const silent of invites.filter((i) => !plannedAgents.has(i.agentId))) {
    const silentAgent = ctx.registry.agents.get(silent.agentId);
    const rejectedPayload = {
      type: "rejected" as const,
      job_id: requestId,
      request_id: requestId,
      plan_id: null,
      reason: "plan window closed without a submission",
    };
    if (silentAgent) await notifyAgent(ctx, silentAgent, rejectedPayload);
    await ctx.db
      .update(jobInvites)
      .set({ status: "rejected" })
      .where(and(eq(jobInvites.requestId, requestId), eq(jobInvites.agentId, silent.agentId)));
  }

  return { selected: true, winner_agent_id: win.agentId };
}

function artifactFromInput(agent: RegistryAgent, input: JobDeliverableInput): PdfArtifact {
  const raw = input.artifact;
  const pdf_base64 = raw.pdf_base64.replace(/\s+/g, "");
  const bytes = Buffer.from(pdf_base64, "base64");
  const header = bytes.subarray(0, 5).toString("latin1");
  if (header !== "%PDF-") {
    throw new PushJobError(422, "artifact.pdf_base64 is not a PDF");
  }
  const self =
    input.self_confidence ?? raw.self_report ?? agent.policy.execution?.self_report ?? agent.baselineConfidence;
  const declared = raw.declared_latency_ms ?? 0;
  return {
    artifact_ref: raw.artifact_ref?.trim() || newId("art"),
    kind: "pdf",
    producer_agent_id: agent.agentId,
    pdf_base64,
    self_report: self,
    observed_latency_ms: raw.observed_latency_ms ?? declared,
    declared_latency_ms: declared,
  };
}

export async function submitDeliverable(
  db: Db,
  requestId: string,
  agentId: string,
  input: JobDeliverableInput,
) {
  await selectPlansIfReady(db, requestId);
  const ctx = await buildContext(db, requestId);
  if (ctx.request.executionMode !== "push") {
    throw new PushJobError(409, "deliverables are only accepted on push jobs");
  }
  if (ctx.request.status !== "executing") {
    throw new PushJobError(409, `job is not awaiting delivery (status=${ctx.request.status})`);
  }
  const state = getState(ctx);
  const winner = state.hops[0];
  if (!winner || winner.agent_id !== agentId) {
    throw new PushJobError(403, "only the selected winner may deliver");
  }
  if (state.artifact) {
    throw new PushJobError(409, "deliverable already posted");
  }

  const agent = getAgent(ctx.registry, agentId);
  const artifact = artifactFromInput(agent, input);
  const facts = await inspectArtifact(artifact);
  const event = await ctx.ledger.append({
    type: "artifact_produced",
    agent_id: agentId,
    latency_ms: artifact.observed_latency_ms,
    payload: {
      artifact_ref: artifact.artifact_ref,
      kind: artifact.kind,
      plan_id: winner.plan_id,
      hop_index: 0,
      pages: facts.pages,
      bytes: facts.bytes,
      text_chars: facts.text.length,
      links: facts.links.length,
      declared_latency_ms: artifact.declared_latency_ms,
      observed_latency_ms: artifact.observed_latency_ms,
      self_report: artifact.self_report,
    },
  });

  await saveState(ctx, {
    ...state,
    artifact,
    artifact_event_id: event.event_id,
    elapsed_s: round6(state.elapsed_s + artifact.observed_latency_ms / 1000),
    pending_latency_s: 0,
  });
  await setRequestStatus(ctx, "verifying");

  await verifyDelivery(db, requestId);
  await settleChain(db, requestId);
  return finalizeRequest(db, requestId);
}

export async function listInbox(
  db: Db,
  agentId: string,
  opts: { unreadOnly?: boolean; markRead?: boolean } = {},
): Promise<Array<{
  inbox_id: string;
  job_id: string;
  request_id: string;
  type: string;
  payload: Record<string, unknown>;
  delivered_via: string;
  read_at: string | null;
  created_at: string;
}>> {
  const rows = await db
    .select()
    .from(agentInbox)
    .where(eq(agentInbox.agentId, agentId))
    .orderBy(desc(agentInbox.createdAt));
  const filtered = opts.unreadOnly ? rows.filter((r) => !r.readAt) : rows;
  if (opts.markRead) {
    const now = new Date();
    for (const row of filtered.filter((r) => !r.readAt)) {
      await db.update(agentInbox).set({ readAt: now }).where(eq(agentInbox.inboxId, row.inboxId));
      row.readAt = now;
    }
  }
  return filtered.map((r) => ({
    inbox_id: r.inboxId,
    job_id: r.requestId,
    request_id: r.requestId,
    type: r.type,
    payload: r.payload,
    delivered_via: r.deliveredVia,
    read_at: r.readAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}
