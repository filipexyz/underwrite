/**
 * The marketplace loop — one function per workflow step.
 *
 *   auction → contract → [ execute → verify → settle ]* → finalize
 *
 * Every function rebuilds its context from Neon, does one bounded amount of
 * work, writes ledger events + state, and returns. That is what lets the
 * loop run as short Vercel functions with the database holding state between
 * hops (ARCHITECTURE.md "Vercel serverless: short steps").
 *
 * Nothing here knows about A, B, C1 or C2. Agents are rows; the seed is data.
 */
import { and, eq } from "drizzle-orm";
import type { PlanConstraints, RequestStatus, Verification } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { bids, escrows, plans, requests, verifications, type BidRow, type EscrowRow, type VerificationRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { deriveMetrics } from "@/lib/ledger/ledger";
import { runInference } from "@/lib/observability/inference";
import { round6 } from "@/lib/observability/pricing";
import { inspectArtifact } from "@/lib/verification/inspect";
import { verifyArtifact } from "@/lib/verification/verify";
import { DEMO_INPUT_HTML, parseSource, renderDeliverable, type SourceDocument } from "./artifact";
import { emitAttribution } from "./attribution";
import { costHonestySample, latencySample, underwritingSample, updateAxes, updatePairwiseTrust } from "./axes";
import { buildContext, DEMO_PACING, pace, RULES, setRequestStatus, settleInferenceCost, type EngineContext } from "./context";
import { buyerWalletId } from "./credits";
import {
  chargeCommission,
  createAndLockEscrow,
  markEscalated,
  refundEscrow,
  releaseEscrow,
  settleStake,
  allDeclaredChecksPassed,
  slaMet,
  withholdEscrow,
  type SlaEvidence,
} from "./escrow";
import { planFromQuote, validatePlan } from "./plans";
import { buildQuote, chainLabel, commissionOf, flattenChain, priceToBuyer, selectSubcontractor, stakeFor, type Quote, type Selection } from "./quotes";
import { discover, getAgent, type RegistryAgent } from "./registry";
import { EMPTY_STATE, type EngineState, type HopRecord } from "./types";

const EPS = 1e-9;

export type StepResult = {
  request_id: string;
  status: RequestStatus;
  settled: boolean;
};

export class PlanRejectedError extends Error {
  constructor(
    readonly agentId: string,
    readonly reasons: string[],
  ) {
    super(`plan by ${agentId} rejected: ${reasons.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// State + shared helpers
// ---------------------------------------------------------------------------

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

function result(ctx: EngineContext, settled: boolean): StepResult {
  return { request_id: ctx.request.requestId, status: ctx.request.status as RequestStatus, settled };
}

function sourceFor(ctx: EngineContext): SourceDocument {
  const html =
    ctx.request.files.find((f) => f.media_type.includes("html"))?.content ??
    ctx.request.files.find((f) => f.media_type.includes("markdown") || /\.md$/i.test(f.name))?.content ??
    DEMO_INPUT_HTML;
  return parseSource(html, ctx.request.requirement);
}

function describeDeliverable(source: SourceDocument): string {
  return `PDF ${source.page_size}, ${source.margins_cm}cm margins, ~${source.expected_pages} page(s), text preserved, fonts embedded, ${source.links.length} link(s) preserved`;
}

async function loadBid(ctx: EngineContext, bidId: string): Promise<BidRow> {
  const [row] = await ctx.db.select().from(bids).where(eq(bids.bidId, bidId));
  if (!row) throw new Error(`bid not found: ${bidId}`);
  return row;
}

async function loadEscrow(ctx: EngineContext, escrowId: string): Promise<EscrowRow> {
  const [row] = await ctx.db.select().from(escrows).where(eq(escrows.escrowId, escrowId));
  if (!row) throw new Error(`escrow not found: ${escrowId}`);
  return row;
}

export function rowToVerification(row: VerificationRow): Verification {
  return {
    verification_id: row.verificationId,
    request_id: row.requestId,
    artifact_ref: row.artifactRef,
    producer_agent_id: row.producerAgentId,
    checks: row.checks,
    confidence: row.confidence,
    verdict: row.verdict as Verification["verdict"],
    judges: row.judges,
    judges_disagree: row.judgesDisagree,
  };
}

// ---------------------------------------------------------------------------
// Step 1 — auction (CONTRACTS.md §3): one round, cheapest compliant bid wins
// ---------------------------------------------------------------------------

export async function runAuction(db: Db, requestId: string): Promise<StepResult> {
  const ctx = await buildContext(db, requestId);
  if (ctx.request.status !== "received") return result(ctx, getState(ctx).settled);
  await setRequestStatus(ctx, "auctioning");
  const req = ctx.request;

  const bidders = discover(ctx.registry, { specialty: req.category }).filter((a) => a.policy.prime);
  const submitted: Array<{ row: BidRow; quote: Quote; agent: RegistryAgent }> = [];

  for (const agent of bidders) {
    const prime = agent.policy.prime;
    if (!prime) continue;
    const quote = buildQuote(agent, prime, req.minConfidence, { registry: ctx.registry, ancestors: [], exclude: new Set(), depth: 0, budget_usd: req.maxCostUsd });
    if (!quote) continue;

    const price = priceToBuyer(quote.price_usd);
    const reasons: string[] = [];
    if (price > req.maxCostUsd + EPS) reasons.push(`price $${price} > max $${req.maxCostUsd}`);
    if (quote.promised_confidence < req.minConfidence - EPS) reasons.push(`confidence ${quote.promised_confidence} < ${req.minConfidence}`);
    if (quote.latency_s > req.maxLatencyS + EPS) reasons.push(`latency ${quote.latency_s}s > ${req.maxLatencyS}s`);

    const fallback =
      quote.selection?.rationale ??
      `${agent.name} executes the whole task itself (${quote.subtask}); promises ${quote.promised_confidence} on a track record of ${agent.trust_global}.`;
    const inference = await runInference({
      agent_id: agent.agentId,
      purpose: "bid",
      system: "You are an agent bidding on a marketplace task. Justify your bid in two sentences: confidence, price, and why your declared chain can sustain it.",
      prompt: `Task: ${req.requirement}\nBuyer constraints: max $${req.maxCostUsd}, max ${req.maxLatencyS}s, min confidence ${req.minConfidence}.\nYour bid: $${price} to the buyer, confidence ${quote.promised_confidence}, ${quote.latency_s}s, chain ${chainLabel(quote)}.\nIf you have nothing to add, repeat this structural rationale: ${fallback}`,
    });
    const rationale = inference.text || fallback;

    const [row] = await ctx.db
      .insert(bids)
      .values({
        bidId: newId("bid"),
        requestId: req.requestId,
        agentId: agent.agentId,
        confidence: quote.promised_confidence,
        costUsd: price,
        latencyS: quote.latency_s,
        chain: flattenChain(quote),
        quote,
        rationale,
        trustGlobalSnapshot: agent.trust_global,
        counterOf: null,
        strategyChosen: quote.strategy,
        compliant: reasons.length === 0,
        rejectionReason: reasons.length ? reasons.join("; ") : null,
      })
      .returning();

    const event = await ctx.ledger.append({
      type: "bid_submitted",
      agent_id: agent.agentId,
      model: inference.model,
      tokens_in: inference.tokens_in,
      tokens_out: inference.tokens_out,
      cost_usd: inference.cost_usd,
      latency_ms: inference.latency_ms,
      payload: {
        bid_id: row.bidId,
        confidence: quote.promised_confidence,
        cost_usd: price,
        latency_s: quote.latency_s,
        chain: row.chain,
        strategy_considered: quote.strategy_considered,
        strategy_chosen: quote.strategy,
        rationale,
        trust_global_snapshot: agent.trust_global,
        compliant: row.compliant,
        rejection_reason: row.rejectionReason,
      },
    });
    await settleInferenceCost(ctx, agent.agentId, inference, event.event_id, "bid_planning");
    submitted.push({ row, quote, agent });
    await pace(DEMO_PACING.bid_ms);
  }

  const compliant = submitted
    .filter((s) => s.row.compliant)
    .sort((a, b) => a.row.costUsd - b.row.costUsd || b.row.confidence - a.row.confidence || b.row.trustGlobalSnapshot - a.row.trustGlobalSnapshot);
  const winner = compliant[0];

  if (!winner) {
    await setRequestStatus(ctx, "no_eligible_bid", {
      outcome: {
        reason: "no bid satisfied confidence ≥ min_confidence, latency ≤ max_latency_s and price ≤ max_cost_usd",
        bids: submitted.map((s) => ({ agent_id: s.agent.agentId, cost_usd: s.row.costUsd, confidence: s.row.confidence, rejection: s.row.rejectionReason })),
      },
      completedAt: new Date(),
    });
    await saveState(ctx, { ...EMPTY_STATE, settled: true });
    return result(ctx, true);
  }

  await ctx.db.update(bids).set({ selected: true }).where(eq(bids.bidId, winner.row.bidId));
  await ctx.ledger.append({
    type: "agent_hired",
    agent_id: winner.agent.agentId,
    payload: {
      hirer: buyerWalletId(ctx.request),
      bid_id: winner.row.bidId,
      rule: "cheapest compliant bid; ties → higher confidence → higher trust_global",
      selected_by: "buyer_policy",
      cost_usd: winner.row.costUsd,
      confidence: winner.row.confidence,
      latency_s: winner.row.latencyS,
      chain: winner.row.chain,
      competing_bids: submitted
        .filter((s) => s.row.bidId !== winner.row.bidId)
        .map((s) => ({ agent_id: s.agent.agentId, cost_usd: s.row.costUsd, confidence: s.row.confidence, compliant: s.row.compliant })),
    },
  });

  await saveState(ctx, { ...EMPTY_STATE, bid_id: winner.row.bidId });
  await setRequestStatus(ctx, "contracting");
  return result(ctx, false);
}

// ---------------------------------------------------------------------------
// Step 2 — contract: plans published + validated, hops hired, escrows locked
// ---------------------------------------------------------------------------

type ContractArgs = {
  quote: Quote;
  hirerId: string | null;
  parentPlanId: string | null;
  hopIndex: number;
  constraints: PlanConstraints;
  specialty: string;
  /** The hirer's evidence for choosing this hop. */
  selection: Selection | null;
  source: SourceDocument;
  /** Root of a re-plan: keeps its escrow and original deadline, is not re-hired, supersedes its previous plan. */
  root?: { escrow_id: string; supersedes_plan_id: string; deadline_s: number } | null;
  /** Planning already paid for at bid time (top hop of the first attempt). */
  fromBidId?: string | null;
};

async function contractSubtree(ctx: EngineContext, args: ContractArgs): Promise<HopRecord[]> {
  const { quote } = args;
  const agent = getAgent(ctx.registry, quote.agent_id);
  const isTop = args.parentPlanId === null;

  const fallbackRationale =
    quote.selection?.rationale ?? `${agent.name} executes ${quote.subtask} itself and underwrites ${quote.promised_confidence}.`;
  const charged = !args.fromBidId;
  const inference = charged
    ? await runInference({
        agent_id: agent.agentId,
        purpose: "plan",
        system: "You are an agent publishing a plan before executing. State deliverable, promised confidence, cost, deadline and the chain you declare.",
        prompt: `Subtask: ${quote.subtask}\nConstraints: max $${args.constraints.max_cost_usd}, max ${args.constraints.max_latency_s}s, floor ${args.constraints.min_confidence}.\nDeclared chain: ${chainLabel(quote)}.\nIf you have nothing to add, repeat this structural rationale: ${fallbackRationale}`,
      })
    : null;

  const draft = planFromQuote({
    request_id: ctx.request.requestId,
    quote,
    parent_plan_id: args.parentPlanId,
    plan_cost_usd: inference?.cost_usd ?? 0,
    deliverable: describeDeliverable(args.source),
    rationale: inference?.text ?? fallbackRationale,
  });
  const validation = validatePlan(draft, args.constraints, ctx.registry);

  await ctx.db.insert(plans).values({
    planId: draft.plan_id,
    requestId: draft.request_id,
    agentId: draft.agent_id,
    parentPlanId: draft.parent_plan_id,
    supersedesPlanId: args.root?.supersedes_plan_id ?? null,
    deliverable: draft.deliverable,
    promisedConfidence: draft.promised_confidence,
    maxCostUsd: draft.max_cost_usd,
    estLatencyS: draft.est_latency_s,
    chain: draft.chain,
    rationale: draft.rationale,
    planCostUsd: draft.plan_cost_usd,
    stakeUsd: draft.stake_usd,
    strategyConsidered: draft.strategy_considered,
    strategyChosen: draft.strategy_chosen,
    status: validation.ok ? "validated" : "rejected",
    rejectionReason: validation.ok ? null : validation.reasons.join("; "),
  });

  const generated = await ctx.ledger.append({
    type: "plan_generated",
    agent_id: agent.agentId,
    model: inference?.model ?? null,
    tokens_in: inference?.tokens_in ?? 0,
    tokens_out: inference?.tokens_out ?? 0,
    cost_usd: inference?.cost_usd ?? 0,
    latency_ms: inference?.latency_ms ?? 0,
    payload: {
      plan_id: draft.plan_id,
      parent_plan_id: draft.parent_plan_id,
      supersedes_plan_id: args.root?.supersedes_plan_id ?? null,
      from_bid_id: args.fromBidId ?? null,
      hop_index: args.hopIndex,
      deliverable: draft.deliverable,
      promised_confidence: draft.promised_confidence,
      max_cost_usd: draft.max_cost_usd,
      est_latency_s: draft.est_latency_s,
      chain: draft.chain,
      strategy_considered: draft.strategy_considered,
      strategy_chosen: draft.strategy_chosen,
      rationale: draft.rationale,
      is_top: isTop,
    },
  });
  if (inference) await settleInferenceCost(ctx, agent.agentId, inference, generated.event_id, "plan_generation");

  await ctx.ledger.append({
    type: validation.ok ? "plan_validated" : "plan_rejected",
    agent_id: agent.agentId,
    parent_event_id: generated.event_id,
    payload: {
      plan_id: draft.plan_id,
      constraints: args.constraints,
      checks: validation.checks,
      ...(validation.ok ? {} : { reasons: validation.reasons }),
    },
  });
  if (!validation.ok) throw new PlanRejectedError(agent.agentId, validation.reasons);

  let escrowId: string;
  if (args.root) {
    escrowId = args.root.escrow_id;
  } else {
    if (args.hirerId) {
      await ctx.ledger.append({
        type: "agent_hired",
        agent_id: agent.agentId,
        parent_event_id: generated.event_id,
        payload: {
          hirer: args.hirerId,
          hop_index: args.hopIndex,
          specialty: args.specialty,
          price_usd: quote.price_usd,
          promised_confidence: quote.promised_confidence,
          floor: quote.floor_required,
          selection: args.selection,
        },
      });
    }
    await ctx.ledger.append({
      type: "task_delegated",
      agent_id: args.hirerId ?? null,
      parent_event_id: generated.event_id,
      payload: {
        from: args.hirerId ?? buyerWalletId(ctx.request),
        to: agent.agentId,
        hop_index: args.hopIndex,
        subtask: quote.subtask,
        specialty: args.specialty,
        floor: quote.floor_required,
        price_usd: quote.price_usd,
        deadline_s: args.constraints.max_latency_s,
        plan_id: draft.plan_id,
      },
    });

    const amount = isTop ? priceToBuyer(quote.price_usd) : quote.price_usd;
    const escrow = await createAndLockEscrow(ctx, {
      plan_id: draft.plan_id,
      hop_index: args.hopIndex,
      payer_agent_id: args.hirerId,
      payee_agent_id: agent.agentId,
      amount_usd: amount,
      stake_usd: stakeFor(amount),
      min_confidence: quote.floor_required,
      payload: { promised_confidence: quote.promised_confidence, specialty: args.specialty },
    });
    escrowId = escrow.escrowId;
  }

  const record: HopRecord = {
    hop_index: args.hopIndex,
    agent_id: agent.agentId,
    role: quote.role,
    hirer_id: args.hirerId,
    plan_id: draft.plan_id,
    escrow_id: escrowId,
    price_usd: quote.price_usd,
    own_cost_usd: quote.own_cost_usd,
    promised_confidence: quote.promised_confidence,
    floor: quote.floor_required,
    own_latency_s: quote.own_latency_s,
    est_latency_s: quote.latency_s,
    deadline_s: args.root?.deadline_s ?? args.constraints.max_latency_s,
    strategy: quote.strategy,
    subtask: quote.subtask,
    specialty: args.specialty,
    selection: args.selection,
  };
  await pace(DEMO_PACING.contract_ms);

  if (!quote.sub) return [record];
  const children = await contractSubtree(ctx, {
    quote: quote.sub,
    hirerId: agent.agentId,
    parentPlanId: draft.plan_id,
    hopIndex: args.hopIndex + 1,
    constraints: {
      max_cost_usd: round6(quote.price_usd - quote.own_cost_usd),
      max_latency_s: args.constraints.max_latency_s - quote.own_latency_s,
      min_confidence: quote.sub.floor_required,
      ancestors: [...args.constraints.ancestors, agent.agentId],
    },
    specialty: quote.selection?.specialty ?? args.specialty,
    selection: quote.selection,
    source: args.source,
  });
  return [record, ...children];
}

export async function contractChain(db: Db, requestId: string): Promise<StepResult> {
  const ctx = await buildContext(db, requestId);
  const state = getState(ctx);
  if (ctx.request.status !== "contracting" || !state.bid_id) return result(ctx, state.settled);

  const bid = await loadBid(ctx, state.bid_id);
  const source = sourceFor(ctx);
  try {
    const hops = await contractSubtree(ctx, {
      quote: bid.quote,
      hirerId: null,
      parentPlanId: null,
      hopIndex: 0,
      constraints: {
        max_cost_usd: ctx.request.maxCostUsd,
        max_latency_s: ctx.request.maxLatencyS,
        min_confidence: ctx.request.minConfidence,
        ancestors: [],
      },
      specialty: ctx.request.category,
      selection: null,
      source,
      fromBidId: bid.bidId,
    });
    await saveState(ctx, {
      ...state,
      hops,
      attempt: 1,
      pending_latency_s: hops.reduce((sum, h) => sum + h.own_latency_s, 0),
    });
    await setRequestStatus(ctx, "executing");
    return result(ctx, false);
  } catch (error) {
    if (error instanceof PlanRejectedError) return failHonestly(ctx, state, `plan rejected: ${error.message}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Step 3 — execute: the leaf hop produces the artifact
// ---------------------------------------------------------------------------

export async function executeLeaf(db: Db, requestId: string): Promise<StepResult> {
  const ctx = await buildContext(db, requestId);
  const state = getState(ctx);
  if (ctx.request.status !== "executing" || state.hops.length === 0) return result(ctx, state.settled);

  const leaf = state.hops[state.hops.length - 1];
  const agent = getAgent(ctx.registry, leaf.agent_id);
  const exec = agent.policy.execution;
  if (!exec) return failHonestly(ctx, state, `${agent.agentId} was contracted to execute but has no execution capability`);

  const source = sourceFor(ctx);
  const artifact = await renderDeliverable(source, agent.agentId, exec);
  const facts = await inspectArtifact(artifact);
  const inference = await runInference({
    agent_id: agent.agentId,
    purpose: "render",
    system: "You are a rendering agent. Report what you produced in one sentence.",
    prompt: `Render ${source.text.length} characters of HTML (${source.links.length} links) to an ${source.page_size} PDF with ${source.margins_cm}cm margins. Observed: ${facts.pages} page(s), ${facts.bytes} bytes, ${facts.links.length} link(s).`,
  });

  const event = await ctx.ledger.append({
    type: "artifact_produced",
    agent_id: agent.agentId,
    model: inference.model,
    tokens_in: inference.tokens_in,
    tokens_out: inference.tokens_out,
    cost_usd: inference.cost_usd,
    latency_ms: artifact.observed_latency_ms,
    payload: {
      artifact_ref: artifact.artifact_ref,
      kind: artifact.kind,
      plan_id: leaf.plan_id,
      hop_index: leaf.hop_index,
      attempt: state.attempt,
      pages: facts.pages,
      bytes: facts.bytes,
      text_chars: facts.text.length,
      links: facts.links.length,
      declared_latency_ms: artifact.declared_latency_ms,
      observed_latency_ms: artifact.observed_latency_ms,
      /** Displayed as suspect, never trusted (D-005). */
      self_report: artifact.self_report,
      producer_note: inference.text || `PDF ${facts.pages}p ${facts.bytes}B`,
    },
  });
  await settleInferenceCost(ctx, agent.agentId, inference, event.event_id, "render_inference");

  await saveState(ctx, {
    ...state,
    artifact,
    artifact_event_id: event.event_id,
    render_cost_usd: inference.cost_usd,
    elapsed_s: round6(state.elapsed_s + state.pending_latency_s + artifact.observed_latency_ms / 1000),
    pending_latency_s: 0,
  });
  await setRequestStatus(ctx, "verifying");
  // The execution beat is the one the audience is watching: it runs as long as the agent said it would.
  await pace(Math.max(DEMO_PACING.execute_floor_ms, Math.round(leaf.own_latency_s * 1000)));
  return result(ctx, false);
}

// ---------------------------------------------------------------------------
// Step 4 — verify: checks, judges, confidence
// ---------------------------------------------------------------------------

export async function verifyDelivery(db: Db, requestId: string): Promise<StepResult> {
  const ctx = await buildContext(db, requestId);
  const state = getState(ctx);
  if (ctx.request.status !== "verifying" || !state.artifact) return result(ctx, state.settled);

  const leaf = state.hops[state.hops.length - 1];
  const outcome = await verifyArtifact(ctx, {
    artifact: state.artifact,
    source: sourceFor(ctx),
    producer: getAgent(ctx.registry, leaf.agent_id),
    chainAgentIds: state.hops.map((h) => h.agent_id),
    planId: leaf.plan_id,
    spec: ctx.request.verification,
    artifactEventId: state.artifact_event_id,
    category: ctx.request.category,
    taskRequirement: ctx.request.requirement,
  });

  await saveState(ctx, {
    ...state,
    verification: {
      verification_id: outcome.verification.verification_id,
      objective: outcome.objective,
      evidence_event_ids: [
        ...(state.artifact_event_id ? [state.artifact_event_id] : []),
        ...outcome.check_event_ids,
        ...outcome.judging.event_ids,
      ],
    },
  });
  await pace(DEMO_PACING.verify_ms);
  return result(ctx, false);
}

// ---------------------------------------------------------------------------
// Step 5 — settle: escrows, stakes, attribution, axes, escalation
// ---------------------------------------------------------------------------

type Escalation = { hirer_index: number; quote: Quote; selection: Selection };

export async function settleChain(db: Db, requestId: string): Promise<StepResult> {
  const ctx = await buildContext(db, requestId);
  const state = getState(ctx);
  if (ctx.request.status !== "verifying" || !state.verification || !state.artifact) return result(ctx, state.settled);

  const [verRow] = await ctx.db.select().from(verifications).where(eq(verifications.verificationId, state.verification.verification_id));
  if (!verRow) throw new Error(`verification not found: ${state.verification.verification_id}`);
  const verification = rowToVerification(verRow);
  const delivered = verification.confidence.computed;
  const allChecksPassed = allDeclaredChecksPassed(verification.checks) || state.verification.objective === 1;
  const evidence: SlaEvidence = {
    verdict: verification.verdict,
    confidence: delivered,
    judges_disagree: verification.judges_disagree,
    all_checks_passed: allChecksPassed,
  };
  const hops = state.hops;
  const leafIndex = hops.length - 1;
  const leaf = hops[leafIndex];
  const blown = (promised: number) => delivered < promised - RULES.PROMISE_TOLERANCE;

  for (const j of verification.judges) {
    await updateAxes(ctx, j.judge_id, { judgment: j.verdict === verification.verdict ? 1 : 0 }, { reason: "verdict compared with the deterministic checks" });
  }
  await updateAxes(
    ctx,
    leaf.agent_id,
    {
      execution: state.verification.objective ?? (verification.verdict === "pass" ? 1 : 0),
      underwriting: underwritingSample(delivered, leaf.promised_confidence),
      latency: latencySample(state.artifact.observed_latency_ms / 1000, leaf.deadline_s),
      cost_honesty: costHonestySample(state.render_cost_usd, leaf.own_cost_usd),
    },
    {
      reason: "delivery verified",
      evidence: { promised_confidence: leaf.promised_confidence, delivered_confidence: delivered, verification_id: verification.verification_id },
    },
  );

  const withheld: Array<{ index: number; event_id: string }> = [];
  let failedAt: number | null = null;
  let escalation: Escalation | null = null;
  let topReleased = false;

  for (let i = leafIndex; i >= 0; i -= 1) {
    const hop = hops[i];
    const escrow = await loadEscrow(ctx, hop.escrow_id);
    if (escrow.status !== "LOCKED") continue;

    if (slaMet(escrow, evidence)) {
      await releaseEscrow(ctx, escrow, {
        ...evidence,
        payload: {
          promised_confidence: hop.promised_confidence,
          attempt: state.attempt,
          execution_first_sla: Boolean(evidence.all_checks_passed && delivered < escrow.minConfidence),
        },
      });
      await settleStake(ctx, escrow, { promised_confidence: hop.promised_confidence, delivered_confidence: delivered, blown: blown(hop.promised_confidence) });
      if (i === 0) {
        await chargeCommission(ctx, escrow, commissionOf(escrow.amountUsd), null);
        topReleased = true;
      }
      if (i !== leafIndex) {
        await updateAxes(
          ctx,
          hop.agent_id,
          { underwriting: underwritingSample(delivered, hop.promised_confidence), latency: latencySample(state.elapsed_s, hop.deadline_s) },
          { reason: "hop settled: floor met", evidence: { promised_confidence: hop.promised_confidence, delivered_confidence: delivered } },
        );
      }
      if (hop.hirer_id) {
        await updatePairwiseTrust(ctx, { from: hop.hirer_id, to: hop.agent_id, sample: 1, reason: `${hop.agent_id} met the floor ${hop.floor} asked by ${hop.hirer_id}` });
        await updateAxes(ctx, hop.hirer_id, { selection: 1 }, { reason: `subcontract ${hop.agent_id} met its floor` });
      }
      continue;
    }

    failedAt ??= i;
    const { event_id } = await withholdEscrow(ctx, escrow, {
      verdict: verification.verdict,
      confidence: delivered,
      promised_confidence: hop.promised_confidence,
      payload: { judges_disagree: verification.judges_disagree, attempt: state.attempt },
    });
    await settleStake(ctx, escrow, {
      promised_confidence: hop.promised_confidence,
      delivered_confidence: delivered,
      blown: blown(hop.promised_confidence),
      ref_event_id: event_id,
    });
    if (i !== leafIndex) {
      await updateAxes(
        ctx,
        hop.agent_id,
        { underwriting: underwritingSample(delivered, hop.promised_confidence) },
        { reason: "hop settled: floor not met", parent_event_id: event_id, evidence: { promised_confidence: hop.promised_confidence, delivered_confidence: delivered } },
      );
    }
    withheld.push({ index: i, event_id });
    if (i === 0) break;

    const hirer = hops[i - 1];
    await updatePairwiseTrust(ctx, {
      from: hirer.agent_id,
      to: hop.agent_id,
      sample: 0,
      reason: `${hop.agent_id} delivered ${delivered} against the floor ${hop.floor} asked by ${hirer.agent_id}`,
      parent_event_id: event_id,
    });

    escalation = findEscalation(ctx, state, hops, i, [...state.failed_agents, ...hops.slice(i).map((h) => h.agent_id)]);
    if (escalation) break;
  }

  const failedAgents = [...new Set([...state.failed_agents, ...withheld.map((w) => hops[w.index].agent_id)])];

  let attributionEventId: string | null = null;
  if (failedAt !== null) {
    const attribution = await emitAttribution(ctx, {
      hops,
      failedHopIndex: failedAt,
      verification,
      evidenceEventIds: [...state.verification.evidence_event_ids, ...withheld.map((w) => w.event_id)],
      parentEventId: withheld[0]?.event_id ?? null,
    });
    attributionEventId = attribution.event_id;
    const { root_cause, blamed_agent } = attribution.attribution;
    if (blamed_agent) {
      const axis = root_cause === "bad_selection" ? "selection" : root_cause === "bad_underwriting" ? "underwriting" : "execution";
      await updateAxes(ctx, blamed_agent, { [axis]: 0 }, { reason: `attribution: ${root_cause}`, parent_event_id: attribution.event_id });
    }
    for (const w of withheld) {
      const hirer = hops[w.index].hirer_id;
      if (hirer && hirer !== blamed_agent) {
        await updateAxes(ctx, hirer, { selection: 0.5 }, { reason: `subcontract ${hops[w.index].agent_id} failed; not the root cause`, parent_event_id: attribution.event_id });
      }
    }
  }

  if (topReleased) {
    const events = await ctx.ledger.list();
    const metrics = deriveMetrics(events);
    const top = hops[0];
    await saveState(ctx, { ...state, failed_agents: failedAgents, settled: true });
    await setRequestStatus(ctx, "completed", {
      completedAt: new Date(),
      outcome: {
        certificate: {
          delivered_confidence: delivered,
          promised_confidence: top.promised_confidence,
          min_confidence: ctx.request.minConfidence,
          verdict: verification.verdict,
          judges_agree: !verification.judges_disagree,
          price_usd: priceToBuyer(top.price_usd),
          chain: hops.map((h) => h.agent_id),
          artifact_ref: verification.artifact_ref,
          verification_id: verification.verification_id,
          rubric_version: ctx.request.verification.rubric_version,
          attempts: state.attempt,
          escalations: state.escalations,
          elapsed_s: state.elapsed_s,
        },
        metrics,
      },
    });
    return result(ctx, true);
  }

  if (escalation && state.escalations < RULES.MAX_ESCALATIONS) {
    return escalate(ctx, { ...state, failed_agents: failedAgents }, hops, withheld, escalation, attributionEventId);
  }

  for (const w of withheld) {
    const escrow = await loadEscrow(ctx, hops[w.index].escrow_id);
    if (escrow.status === "WITHHELD") await refundEscrow(ctx, escrow, w.event_id);
  }
  return failHonestly(
    ctx,
    { ...state, failed_agents: failedAgents },
    escalation
      ? `escalation limit (${RULES.MAX_ESCALATIONS}) reached`
      : `no candidate meets confidence ≥ ${hops[0].floor} within the remaining budget ($${remainingBudget(hops[0])}) and deadline (${remainingDeadline(ctx, state)}s)`,
    { delivered_confidence: delivered, verdict: verification.verdict, judges_disagree: verification.judges_disagree },
  );
}

function remainingBudget(hirer: HopRecord): number {
  return round6(hirer.price_usd - RULES.MIN_OVERHEAD_USD);
}

function remainingDeadline(ctx: EngineContext, state: EngineState): number {
  return round6(ctx.request.maxLatencyS - state.elapsed_s);
}

/**
 * Can the hirer of the failed hop buy a replacement within what it already
 * has — its own contract price (eating its margin down to the minimum
 * overhead) and the time the buyer has left? Never rehires anyone who failed.
 */
function findEscalation(ctx: EngineContext, state: EngineState, hops: HopRecord[], failedIndex: number, exclude: string[]): Escalation | null {
  const hirerIndex = failedIndex - 1;
  const hirer = hops[hirerIndex];
  const failed = hops[failedIndex];
  const hirerAgent = getAgent(ctx.registry, hirer.agent_id);
  const sel = selectSubcontractor(hirerAgent, failed.specialty, hirer.floor, {
    registry: ctx.registry,
    ancestors: hops.slice(0, hirerIndex).map((h) => h.agent_id),
    exclude: new Set(exclude),
    depth: hirerIndex,
    // What the hirer can still pass down. Without it a replacement would quote its raw cost and win on price
    // alone — the escalation is the one place a share-priced market falls back to absolute numbers if it is missed.
    budget_usd: Math.max(0, remainingBudget(hirer)),
  });
  if (!sel.quote) return null;
  const fitsBudget = sel.quote.price_usd <= remainingBudget(hirer) + EPS;
  const fitsDeadline = sel.quote.latency_s + hirer.own_latency_s <= remainingDeadline(ctx, state) + EPS;
  if (!fitsBudget || !fitsDeadline) return null;
  return { hirer_index: hirerIndex, quote: sel.quote, selection: sel.selection };
}

async function escalate(
  ctx: EngineContext,
  state: EngineState,
  hops: HopRecord[],
  withheld: Array<{ index: number; event_id: string }>,
  escalation: Escalation,
  parentEventId: string | null,
): Promise<StepResult> {
  const hirer = hops[escalation.hirer_index];
  const replaced = hops[escalation.hirer_index + 1];

  // Locked money flows back to the payers: the escalator re-locks it for the replacement.
  for (const w of withheld) {
    const escrow = await loadEscrow(ctx, hops[w.index].escrow_id);
    if (escrow.status !== "WITHHELD") continue;
    if (w.index === escalation.hirer_index + 1) await markEscalated(ctx, escrow, w.event_id);
    else await refundEscrow(ctx, escrow, w.event_id);
  }

  await setRequestStatus(ctx, "escalated");
  const event = await ctx.ledger.append({
    type: "escalated",
    agent_id: hirer.agent_id,
    parent_event_id: parentEventId,
    payload: {
      hop_index: escalation.hirer_index + 1,
      from: replaced.agent_id,
      to: chainLabel(escalation.quote),
      escalation: state.escalations + 1,
      remaining_budget_usd: remainingBudget(hirer),
      remaining_deadline_s: remainingDeadline(ctx, state),
      replacement_price_usd: escalation.quote.price_usd,
      replacement_latency_s: escalation.quote.latency_s,
      hirer_margin_before_usd: hirer.own_cost_usd,
      hirer_margin_after_usd: round6(hirer.price_usd - escalation.quote.price_usd),
      selection: escalation.selection,
    },
  });

  const newQuote: Quote = {
    agent_id: hirer.agent_id,
    role: hirer.role,
    strategy: hirer.strategy === "self" ? "outsource" : hirer.strategy,
    strategy_considered: ["self", "decompose", "outsource"],
    subtask: hirer.subtask,
    promised_confidence: hirer.promised_confidence,
    own_cost_usd: round6(hirer.price_usd - escalation.quote.price_usd),
    price_usd: hirer.price_usd,
    own_latency_s: hirer.own_latency_s,
    latency_s: hirer.own_latency_s + escalation.quote.latency_s,
    floor_required: hirer.floor,
    sub: escalation.quote,
    selection: escalation.selection,
  };

  const isTop = escalation.hirer_index === 0;
  const topEscrow = isTop ? await loadEscrow(ctx, hirer.escrow_id) : null;
  try {
    const records = await contractSubtree(ctx, {
      quote: newQuote,
      hirerId: hirer.hirer_id,
      parentPlanId: isTop ? null : hops[escalation.hirer_index - 1].plan_id,
      hopIndex: escalation.hirer_index,
      constraints: {
        max_cost_usd: topEscrow ? topEscrow.amountUsd : hirer.price_usd,
        max_latency_s: remainingDeadline(ctx, state),
        min_confidence: hirer.floor,
        ancestors: hops.slice(0, escalation.hirer_index).map((h) => h.agent_id),
      },
      specialty: hirer.specialty,
      selection: hirer.selection,
      source: sourceFor(ctx),
      root: { escrow_id: hirer.escrow_id, supersedes_plan_id: hirer.plan_id, deadline_s: hirer.deadline_s },
    });

    await saveState(ctx, {
      ...state,
      hops: [...hops.slice(0, escalation.hirer_index), ...records],
      attempt: state.attempt + 1,
      escalations: state.escalations + 1,
      pending_latency_s: records.reduce((sum, h) => sum + h.own_latency_s, 0),
      artifact: null,
      artifact_event_id: null,
      render_cost_usd: 0,
      verification: null,
    });
    await setRequestStatus(ctx, "executing");
    return result(ctx, false);
  } catch (error) {
    if (error instanceof PlanRejectedError) return failHonestly(ctx, state, `re-plan rejected after escalation: ${error.message}`, { escalated_event_id: event.event_id });
    throw error;
  }
}

/**
 * Honest-failure boundary (ARCHITECTURE.md §5): the marketplace says so. The
 * buyer's escrow is refunded (v0 applies `refund` mechanics to every policy and
 * records the declared policy so `discount` / `accept_flagged` can be wired next).
 */
async function failHonestly(ctx: EngineContext, state: EngineState, reason: string, extra: Record<string, unknown> = {}): Promise<StepResult> {
  for (const hop of state.hops) {
    const [escrow] = await ctx.db.select().from(escrows).where(and(eq(escrows.escrowId, hop.escrow_id), eq(escrows.status, "LOCKED")));
    if (escrow) {
      const { event_id } = await withholdEscrow(ctx, escrow, {
        verdict: "fail",
        confidence: 0,
        promised_confidence: hop.promised_confidence,
        payload: { reason },
      });
      await settleStake(ctx, escrow, { promised_confidence: hop.promised_confidence, delivered_confidence: 0, blown: false, ref_event_id: event_id });
      await refundEscrow(ctx, escrow, event_id);
    }
  }
  const events = await ctx.ledger.list();
  await saveState(ctx, { ...state, settled: true });
  await setRequestStatus(ctx, "failed", {
    error: reason,
    completedAt: new Date(),
    outcome: {
      reason,
      failure_policy: ctx.request.failurePolicy,
      applied: "refund",
      attempts: state.attempt,
      escalations: state.escalations,
      metrics: deriveMetrics(events),
      ...extra,
    },
  });
  return result(ctx, true);
}

// ---------------------------------------------------------------------------
// Step 6 — finalize: metrics from the ledger, never from a counter
// ---------------------------------------------------------------------------

export async function finalizeRequest(db: Db, requestId: string): Promise<StepResult & { metrics: ReturnType<typeof deriveMetrics> }> {
  const ctx = await buildContext(db, requestId);
  const events = await ctx.ledger.list();
  const metrics = deriveMetrics(events);
  const outcome = { ...(ctx.request.outcome ?? {}), metrics };
  await ctx.db.update(requests).set({ outcome, updatedAt: new Date() }).where(eq(requests.requestId, requestId));
  return { ...result(ctx, true), metrics };
}

/** Runs the whole loop in-process (scripts, tests). The Mastra workflow wraps the same steps. */
export async function runLoopInline(db: Db, requestId: string): Promise<StepResult> {
  let step = await runAuction(db, requestId);
  if (step.settled) return finalizeRequest(db, requestId);
  step = await contractChain(db, requestId);
  while (!step.settled) {
    step = await executeLeaf(db, requestId);
    if (step.settled) break;
    step = await verifyDelivery(db, requestId);
    if (step.settled) break;
    step = await settleChain(db, requestId);
  }
  return finalizeRequest(db, requestId);
}
