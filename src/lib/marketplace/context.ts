/**
 * Shared engine context for one request: DB, ledger, registry, wallets.
 * Every step of the workflow rebuilds it from Neon — steps are stateless.
 */
import { eq } from "drizzle-orm";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { requests, wallets, type RequestRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { Ledger } from "@/lib/ledger/ledger";
import type { InferenceResult } from "@/lib/observability/inference";
import { round6 } from "@/lib/observability/pricing";
import { loadRegistry, type Registry } from "./registry";

/** Marketplace constants — the "police rules" and the revenue model, in one place. */
export const RULES = {
  /** Commission on the settled top-level price (D-028). */
  COMMISSION_RATE: 0.05,
  /** Stake posted by every hop, as a share of what it charges (D-028). */
  STAKE_RATE: 0.2,
  /** A hop blows its promise when delivered < promised − this tolerance. */
  PROMISE_TOLERANCE: 0.05,
  /** A hop cannot pass 100% of its budget down — it must do something (guardrail 3). */
  MIN_OVERHEAD_USD: 0.0005,
  /** Guardrail 1 — A→B→C. */
  MAX_DEPTH: 2,
  /** Guardrail 2. */
  MAX_HOPS: 4,
  /** `cheapest_trusted` ignores candidates below this global trust. */
  TRUSTED_MIN: 0.75,
  /** Nobody rehires a peer they have learned to distrust. */
  PAIRWISE_MIN: 0.5,
  MAX_ESCALATIONS: 2,
} as const;

export type EngineContext = {
  db: Db;
  ledger: Ledger;
  request: RequestRow;
  registry: Registry;
};

export async function buildContext(db: Db, requestId: string): Promise<EngineContext> {
  const [request] = await db.select().from(requests).where(eq(requests.requestId, requestId));
  if (!request) throw new Error(`request not found: ${requestId}`);
  const registry = await loadRegistry(db, request.category);
  return { db, ledger: new Ledger(db, requestId), request, registry };
}

export async function refreshRegistry(ctx: EngineContext): Promise<void> {
  ctx.registry = await loadRegistry(ctx.db, ctx.request.category);
}

export async function setRequestStatus(
  ctx: EngineContext,
  status: RequestRow["status"],
  extra: Partial<Pick<RequestRow, "outcome" | "error" | "workflowRunId" | "completedAt">> = {},
): Promise<void> {
  await ctx.db
    .update(requests)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(requests.requestId, ctx.request.requestId));
  ctx.request = { ...ctx.request, status, ...extra };
}

/**
 * The cadence of a run, in ms.
 *
 * A marketplace that settles in 600ms reads as a mock no matter how real the money is, and the person
 * watching cannot see the parts they are meant to judge. These are not latency theatre: each pause sits
 * where a real step would take time — a bid being planned, a contract being locked, an artifact being
 * rendered, a verifier reading it — so the screen fills at the speed the work would actually fill it.
 */
export const DEMO_PACING = {
  /** One bid being planned and priced. */
  bid_ms: 600,
  /** One hop's contract being locked. */
  contract_ms: 450,
  /** A verifier reading the artifact and reaching a verdict. */
  verify_ms: 1600,
  /** Floor for an execution beat, so even an agent declaring 0s is visibly doing something. */
  execute_floor_ms: 1800,
} as const;

/** Tests never sleep: a suite that waits on wall clock is a suite nobody runs. */
function isTestRun(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * Real pause at a step boundary.
 *
 * `DEMO_STEP_DELAY_MS` still overrides the whole cadence with a single fixed value when a stage needs a
 * different rhythm, but nothing has to be configured for the demo to look like work.
 */
export async function pace(ms: number): Promise<void> {
  if (isTestRun()) return;
  const override = env.demoStepDelayMs;
  const wait = override > 0 ? override : ms;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// ---------------------------------------------------------------------------
// Wallets — every movement is two `wallet_updated` rows; Σ deltas == 0 (invariant 11)
// ---------------------------------------------------------------------------

async function adjustWallet(
  ctx: EngineContext,
  ownerId: string,
  delta: number,
  reason: string,
  refEventId: string | null,
): Promise<number> {
  const [row] = await ctx.db.select().from(wallets).where(eq(wallets.ownerId, ownerId));
  if (!row) throw new Error(`wallet not found: ${ownerId}`);
  const balance = round6(row.capitalUsd + delta);
  await ctx.db
    .update(wallets)
    .set({ capitalUsd: balance, updatedAt: new Date() })
    .where(eq(wallets.ownerId, ownerId));
  await ctx.ledger.append({
    type: "wallet_updated",
    agent_id: ctx.registry.agents.has(ownerId) ? ownerId : null,
    parent_event_id: refEventId,
    payload: { owner_id: ownerId, delta_usd: round6(delta), balance_after: balance, reason },
  });
  return balance;
}

export async function moveMoney(
  ctx: EngineContext,
  args: { from: string; to: string; amount_usd: number; reason: string; ref_event_id?: string | null },
): Promise<void> {
  const amount = round6(args.amount_usd);
  if (amount <= 0) return;
  await adjustWallet(ctx, args.from, -amount, args.reason, args.ref_event_id ?? null);
  await adjustWallet(ctx, args.to, amount, args.reason, args.ref_event_id ?? null);
}

export async function walletBalance(ctx: EngineContext, ownerId: string): Promise<number> {
  const [row] = await ctx.db.select().from(wallets).where(eq(wallets.ownerId, ownerId));
  return row?.capitalUsd ?? 0;
}

/** Inference is a cost line: the agent (or the marketplace, for judges) pays the provider. */
export async function settleInferenceCost(
  ctx: EngineContext,
  payer: string,
  result: InferenceResult,
  refEventId: string,
  reason: string,
): Promise<void> {
  if (result.cost_usd <= 0) return;
  await moveMoney(ctx, {
    from: payer,
    to: SYSTEM_WALLETS.provider,
    amount_usd: result.cost_usd,
    reason,
    ref_event_id: refEventId,
  });
}

export const WALLET = SYSTEM_WALLETS;
