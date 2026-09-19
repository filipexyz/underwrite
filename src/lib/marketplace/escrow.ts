/**
 * Escrow state machine (CONTRACTS.md §6). Every transition is checked against
 * `ESCROW_TRANSITIONS`, persisted, mirrored in the ledger and in the wallets.
 *
 * Hard rule enforced here: RELEASED requires `verdict = pass` AND
 * `confidence ≥ escrow.min_confidence`. There is no partial payment.
 */
import { eq } from "drizzle-orm";
import { ESCROW_TRANSITIONS, type EscrowStatus, type Verdict } from "@/lib/contracts";
import { escrows, type EscrowRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { moveMoney, WALLET, type EngineContext } from "./context";

export class EscrowTransitionError extends Error {
  constructor(escrowId: string, from: string, to: string) {
    super(`escrow ${escrowId}: illegal transition ${from} → ${to}`);
  }
}

function payerWallet(escrow: EscrowRow): string {
  return escrow.payerAgentId ?? WALLET.buyer;
}

async function persistStatus(ctx: EngineContext, escrow: EscrowRow, to: EscrowStatus): Promise<EscrowRow> {
  const from = escrow.status as EscrowStatus;
  if (!ESCROW_TRANSITIONS[from].includes(to)) throw new EscrowTransitionError(escrow.escrowId, from, to);
  const terminal = to === "RELEASED" || to === "REFUNDED";
  const [row] = await ctx.db
    .update(escrows)
    .set({ status: to, updatedAt: new Date(), resolvedAt: terminal ? new Date() : null })
    .where(eq(escrows.escrowId, escrow.escrowId))
    .returning();
  return row;
}

export async function createAndLockEscrow(
  ctx: EngineContext,
  args: {
    plan_id: string;
    hop_index: number;
    payer_agent_id: string | null;
    payee_agent_id: string;
    amount_usd: number;
    stake_usd: number;
    min_confidence: number;
    payload?: Record<string, unknown>;
  },
): Promise<EscrowRow> {
  const [created] = await ctx.db
    .insert(escrows)
    .values({
      escrowId: newId("esc"),
      requestId: ctx.request.requestId,
      planId: args.plan_id,
      hopIndex: args.hop_index,
      payerAgentId: args.payer_agent_id,
      payeeAgentId: args.payee_agent_id,
      amountUsd: args.amount_usd,
      stakeUsd: args.stake_usd,
      minConfidence: args.min_confidence,
      status: "CREATED",
    })
    .returning();

  const locked = await persistStatus(ctx, created, "LOCKED");
  const lockEvent = await ctx.ledger.append({
    type: "escrow_locked",
    agent_id: args.payee_agent_id,
    payload: {
      escrow_id: locked.escrowId,
      plan_id: args.plan_id,
      hop_index: args.hop_index,
      payer: args.payer_agent_id ?? WALLET.buyer,
      payee: args.payee_agent_id,
      amount_usd: args.amount_usd,
      min_confidence: args.min_confidence,
      ...args.payload,
    },
  });
  await moveMoney(ctx, {
    from: payerWallet(locked),
    to: WALLET.escrow,
    amount_usd: args.amount_usd,
    reason: `escrow_lock:${locked.escrowId}`,
    ref_event_id: lockEvent.event_id,
  });

  if (args.stake_usd > 0) {
    const stakeEvent = await ctx.ledger.append({
      type: "stake_posted",
      agent_id: args.payee_agent_id,
      parent_event_id: lockEvent.event_id,
      payload: { escrow_id: locked.escrowId, stake_usd: args.stake_usd, promised_confidence: args.payload?.promised_confidence },
    });
    await moveMoney(ctx, {
      from: args.payee_agent_id,
      to: WALLET.escrow,
      amount_usd: args.stake_usd,
      reason: `stake_post:${locked.escrowId}`,
      ref_event_id: stakeEvent.event_id,
    });
  }

  return locked;
}

export type SlaEvidence = { verdict: Verdict; confidence: number; judges_disagree?: boolean };

/** `verdict = pass` AND `confidence ≥ min_confidence` AND judges in agreement (CONTRACTS.md §4/§6). */
export function slaMet(escrow: EscrowRow, evidence: SlaEvidence): boolean {
  return evidence.verdict === "pass" && !evidence.judges_disagree && evidence.confidence >= escrow.minConfidence;
}

export async function releaseEscrow(
  ctx: EngineContext,
  escrow: EscrowRow,
  args: SlaEvidence & { payload?: Record<string, unknown> },
): Promise<EscrowRow> {
  if (!slaMet(escrow, args)) {
    throw new Error(
      `escrow ${escrow.escrowId}: refusing to release (verdict=${args.verdict}, judges_disagree=${Boolean(args.judges_disagree)}, confidence=${args.confidence}, floor=${escrow.minConfidence})`,
    );
  }
  const row = await persistStatus(ctx, escrow, "RELEASED");
  const event = await ctx.ledger.append({
    type: "escrow_released",
    agent_id: escrow.payeeAgentId,
    payload: {
      escrow_id: escrow.escrowId,
      hop_index: escrow.hopIndex,
      payer: payerWallet(escrow),
      payee: escrow.payeeAgentId,
      amount_usd: escrow.amountUsd,
      min_confidence: escrow.minConfidence,
      delivered_confidence: args.confidence,
      ...args.payload,
    },
  });
  await moveMoney(ctx, {
    from: WALLET.escrow,
    to: escrow.payeeAgentId,
    amount_usd: escrow.amountUsd,
    reason: `escrow_release:${escrow.escrowId}`,
    ref_event_id: event.event_id,
  });
  return row;
}

export async function withholdEscrow(
  ctx: EngineContext,
  escrow: EscrowRow,
  args: { verdict: Verdict; confidence: number; promised_confidence: number; payload?: Record<string, unknown> },
): Promise<{ escrow: EscrowRow; event_id: string }> {
  const row = await persistStatus(ctx, escrow, "WITHHELD");
  const event = await ctx.ledger.append({
    type: "escrow_withheld",
    agent_id: escrow.payeeAgentId,
    payload: {
      escrow_id: escrow.escrowId,
      hop_index: escrow.hopIndex,
      payer: payerWallet(escrow),
      payee: escrow.payeeAgentId,
      amount_usd: escrow.amountUsd,
      min_confidence: escrow.minConfidence,
      promised_confidence: args.promised_confidence,
      delivered_confidence: args.confidence,
      verdict: args.verdict,
      ...args.payload,
    },
  });
  return { escrow: row, event_id: event.event_id };
}

/** WITHHELD → ESCALATED: the locked amount returns to the payer, who locks a new escrow for the replacement. */
export async function markEscalated(ctx: EngineContext, escrow: EscrowRow, refEventId: string): Promise<EscrowRow> {
  const row = await persistStatus(ctx, escrow, "ESCALATED");
  await moveMoney(ctx, {
    from: WALLET.escrow,
    to: payerWallet(escrow),
    amount_usd: escrow.amountUsd,
    reason: `escrow_unlock_for_escalation:${escrow.escrowId}`,
    ref_event_id: refEventId,
  });
  return row;
}

/** WITHHELD → REFUNDED: `failure_policy = refund`. The ledger records the refund as wallet movements. */
export async function refundEscrow(ctx: EngineContext, escrow: EscrowRow, refEventId: string | null): Promise<EscrowRow> {
  const row = await persistStatus(ctx, escrow, "REFUNDED");
  await moveMoney(ctx, {
    from: WALLET.escrow,
    to: payerWallet(escrow),
    amount_usd: escrow.amountUsd,
    reason: `escrow_refund:${escrow.escrowId}`,
    ref_event_id: refEventId,
  });
  return row;
}

/**
 * Stake settlement (D-028): refunded when the hop met its own promise (within
 * tolerance), forfeited to the marketplace when it blew it.
 */
export async function settleStake(
  ctx: EngineContext,
  escrow: EscrowRow,
  args: { promised_confidence: number; delivered_confidence: number; blown: boolean; ref_event_id?: string | null },
): Promise<void> {
  if (escrow.stakeUsd <= 0) return;
  const type = args.blown ? "stake_forfeited" : "stake_refunded";
  const event = await ctx.ledger.append({
    type,
    agent_id: escrow.payeeAgentId,
    parent_event_id: args.ref_event_id ?? null,
    payload: {
      escrow_id: escrow.escrowId,
      stake_usd: escrow.stakeUsd,
      promised_confidence: args.promised_confidence,
      delivered_confidence: args.delivered_confidence,
    },
  });
  await moveMoney(ctx, {
    from: WALLET.escrow,
    to: args.blown ? WALLET.marketplace : escrow.payeeAgentId,
    amount_usd: escrow.stakeUsd,
    reason: `${type}:${escrow.escrowId}`,
    ref_event_id: event.event_id,
  });
}

export async function chargeCommission(
  ctx: EngineContext,
  escrow: EscrowRow,
  commission: number,
  refEventId: string | null,
): Promise<void> {
  if (commission <= 0) return;
  const event = await ctx.ledger.append({
    type: "commission_charged",
    agent_id: escrow.payeeAgentId,
    parent_event_id: refEventId,
    payload: { escrow_id: escrow.escrowId, commission_usd: commission, settled_price_usd: escrow.amountUsd },
  });
  await moveMoney(ctx, {
    from: escrow.payeeAgentId,
    to: WALLET.marketplace,
    amount_usd: commission,
    reason: `commission:${escrow.escrowId}`,
    ref_event_id: event.event_id,
  });
}
