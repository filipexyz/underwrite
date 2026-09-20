/**
 * Escrow state machine (CONTRACTS.md §6). Every transition is checked against
 * `ESCROW_TRANSITIONS`, persisted, mirrored in the ledger and in the wallets.
 *
 * Hard rule: RELEASED requires `verdict = pass` and judges in agreement.
 * There is no partial payment. Execution-first SLA (Luís): when every
 * declared applicable check passed, confidence below `min_confidence` must
 * not withhold — `hardcoded_v0` is still recorded for display.
 */
import { eq } from "drizzle-orm";
import { ESCROW_TRANSITIONS, type EscrowStatus, type Verdict } from "@/lib/contracts";
import { escrows, type EscrowRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { buyerWalletId } from "./credits";
import { moveMoney, walletBalance, WALLET, type EngineContext } from "./context";
import { round6 } from "./quotes";

export class EscrowTransitionError extends Error {
  constructor(escrowId: string, from: string, to: string) {
    super(`escrow ${escrowId}: illegal transition ${from} → ${to}`);
  }
}

function payerWallet(ctx: EngineContext, escrow: EscrowRow): string {
  return escrow.payerAgentId ?? buyerWalletId(ctx.request);
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
      payer: args.payer_agent_id ?? buyerWalletId(ctx.request),
      payee: args.payee_agent_id,
      amount_usd: args.amount_usd,
      min_confidence: args.min_confidence,
      ...args.payload,
    },
  });
  await moveMoney(ctx, {
    from: payerWallet(ctx, locked),
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

export class InsufficientHoldError extends Error {
  constructor(
    readonly ownerId: string,
    readonly balanceUsd: number,
    readonly requiredUsd: number,
  ) {
    super(`insufficient wallet balance to hold $${requiredUsd} (have $${balanceUsd})`);
  }
}

/** Reserve the buyer's max budget in the escrow wallet before a winner is chosen. */
export async function holdBuyerBudget(ctx: EngineContext, amountUsd: number): Promise<void> {
  const amount = round6(amountUsd);
  if (amount <= 0) return;
  const payer = buyerWalletId(ctx.request);
  const balance = await walletBalance(ctx, payer);
  if (balance + 1e-9 < amount) throw new InsufficientHoldError(payer, balance, amount);

  const event = await ctx.ledger.append({
    type: "escrow_held",
    payload: {
      payer,
      amount_usd: amount,
      status: "HELD",
      note: "buyer max reserved until best-score select locks a winner",
    },
  });
  await moveMoney(ctx, {
    from: payer,
    to: WALLET.escrow,
    amount_usd: amount,
    reason: `escrow_hold:${ctx.request.requestId}`,
    ref_event_id: event.event_id,
  });
}

/** Refund a hold that never became a locked winner escrow (no plan / failed invite). */
export async function refundBuyerHold(ctx: EngineContext, amountUsd: number, reason: string): Promise<void> {
  const amount = round6(amountUsd);
  if (amount <= 0) return;
  await moveMoney(ctx, {
    from: WALLET.escrow,
    to: buyerWalletId(ctx.request),
    amount_usd: amount,
    reason,
  });
}

/**
 * Lock the winner escrow from an existing hold. Does not debit the buyer again.
 * Surplus (hold − winner price) returns to the buyer. Stake is taken only when
 * the payee wallet can cover it (registered sellers often start at $0).
 */
export async function createLockedEscrowFromHold(
  ctx: EngineContext,
  args: {
    plan_id: string;
    hop_index: number;
    payer_agent_id: string | null;
    payee_agent_id: string;
    amount_usd: number;
    min_confidence: number;
    hold_usd: number;
    stake_usd: number;
    payload?: Record<string, unknown>;
  },
): Promise<EscrowRow> {
  const amount = round6(args.amount_usd);
  const hold = round6(args.hold_usd);
  let stake = round6(args.stake_usd);
  if (stake > 0) {
    const payeeBal = await walletBalance(ctx, args.payee_agent_id);
    if (payeeBal + 1e-9 < stake) stake = 0;
  }

  const [created] = await ctx.db
    .insert(escrows)
    .values({
      escrowId: newId("esc"),
      requestId: ctx.request.requestId,
      planId: args.plan_id,
      hopIndex: args.hop_index,
      payerAgentId: args.payer_agent_id,
      payeeAgentId: args.payee_agent_id,
      amountUsd: amount,
      stakeUsd: stake,
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
      payer: args.payer_agent_id ?? buyerWalletId(ctx.request),
      payee: args.payee_agent_id,
      amount_usd: amount,
      min_confidence: args.min_confidence,
      from_hold_usd: hold,
      ...args.payload,
    },
  });

  const surplus = round6(hold - amount);
  if (surplus > 0) {
    await moveMoney(ctx, {
      from: WALLET.escrow,
      to: payerWallet(ctx, locked),
      amount_usd: surplus,
      reason: `escrow_hold_surplus:${locked.escrowId}`,
      ref_event_id: lockEvent.event_id,
    });
  } else if (surplus < -1e-9) {
    await moveMoney(ctx, {
      from: payerWallet(ctx, locked),
      to: WALLET.escrow,
      amount_usd: round6(-surplus),
      reason: `escrow_hold_topup:${locked.escrowId}`,
      ref_event_id: lockEvent.event_id,
    });
  }

  if (stake > 0) {
    const stakeEvent = await ctx.ledger.append({
      type: "stake_posted",
      agent_id: args.payee_agent_id,
      parent_event_id: lockEvent.event_id,
      payload: { escrow_id: locked.escrowId, stake_usd: stake, promised_confidence: args.payload?.promised_confidence },
    });
    await moveMoney(ctx, {
      from: args.payee_agent_id,
      to: WALLET.escrow,
      amount_usd: stake,
      reason: `stake_post:${locked.escrowId}`,
      ref_event_id: stakeEvent.event_id,
    });
  }

  return locked;
}

export type SlaEvidence = {
  verdict: Verdict;
  confidence: number;
  judges_disagree?: boolean;
  /** True when `runChecks` was conclusive and every declared applicable check passed (`objective === 1`). */
  all_checks_passed?: boolean;
};

/** Every declared applicable check that ran, passed. Empty/unknown check lists are not a pass. */
export function allDeclaredChecksPassed(checks: ReadonlyArray<{ passed: boolean }>): boolean {
  return checks.length > 0 && checks.every((c) => c.passed);
}

/**
 * SLA for escrow release.
 *
 * Execution-first (Luís: "vamo sempre forçar passar se a execução funcionar"):
 * if the deterministic checks are a conclusive pass, the job meets the SLA
 * and escrow releases even when `hardcoded_v0` confidence is below
 * `escrow.minConfidence`. Burned `track_record`, missing judges (null
 * `agreement`), and the self-report blend must not withhold a delivery the
 * checks already accepted. Confidence is still recorded on the ledger.
 *
 * A failed applicable check still withholds. Judge disagreement still
 * withholds. The confidence floor remains a gate only when checks did not
 * all pass (inconclusive / partial).
 */
export function slaMet(escrow: EscrowRow, evidence: SlaEvidence): boolean {
  if (evidence.verdict !== "pass" || evidence.judges_disagree) return false;
  if (evidence.all_checks_passed) return true;
  return evidence.confidence >= escrow.minConfidence;
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
      payer: payerWallet(ctx, escrow),
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
      payer: payerWallet(ctx, escrow),
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
    to: payerWallet(ctx, escrow),
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
    to: payerWallet(ctx, escrow),
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
