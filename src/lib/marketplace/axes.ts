/**
 * Axes (CONTRACTS.md §8): deterministic initial values from the seed, updated
 * by EMA (α = 0.3) with observed outcomes. Each update is an `axes_updated`
 * ledger event carrying before/after so a walk-back can replay reputation.
 *
 * `trust_pairwise` uses the same EMA. It starts empty (D-022): the first
 * observation *is* the trust — a hop that fails you once is not rehired.
 */
import { and, eq } from "drizzle-orm";
import type { AxisName, AxisVector } from "@/lib/contracts";
import { axesFromRow, trustAxes } from "@/lib/db/schema";
import type { EngineContext } from "./context";
import { pairKey, upsertPairwise } from "./registry";

export const EMA_ALPHA = 0.3;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function ema(previous: number | null, sample: number): number {
  const s = clamp01(sample);
  return round4(previous === null ? s : previous * (1 - EMA_ALPHA) + s * EMA_ALPHA);
}

export type AxisSamples = Partial<Record<AxisName, number>>;

export async function updateAxes(
  ctx: EngineContext,
  agentId: string,
  samples: AxisSamples,
  meta: { reason: string; parent_event_id?: string | null; evidence?: Record<string, unknown> },
): Promise<AxisVector> {
  const category = ctx.request.category;
  const [row] = await ctx.db
    .select()
    .from(trustAxes)
    .where(and(eq(trustAxes.agentId, agentId), eq(trustAxes.category, category)));

  const before: AxisVector = row
    ? axesFromRow(row)
    : { execution: null, selection: null, underwriting: null, latency: null, cost_honesty: null, judgment: null };

  const after: AxisVector = { ...before };
  for (const [axis, sample] of Object.entries(samples) as Array<[AxisName, number | undefined]>) {
    if (sample === undefined) continue;
    after[axis] = ema(before[axis], sample);
  }

  const columns = {
    execution: after.execution,
    selection: after.selection,
    underwriting: after.underwriting,
    latency: after.latency,
    costHonesty: after.cost_honesty,
    judgment: after.judgment,
    updatedAt: new Date(),
  };
  if (row) {
    await ctx.db
      .update(trustAxes)
      .set({ ...columns, samples: row.samples + 1 })
      .where(and(eq(trustAxes.agentId, agentId), eq(trustAxes.category, category)));
  } else {
    await ctx.db.insert(trustAxes).values({ agentId, category, ...columns, samples: 1 });
  }

  await ctx.ledger.append({
    type: "axes_updated",
    agent_id: agentId,
    parent_event_id: meta.parent_event_id ?? null,
    payload: {
      category,
      reason: meta.reason,
      samples: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, round4(v as number)])),
      before,
      after,
      alpha: EMA_ALPHA,
      ...meta.evidence,
    },
  });

  const agent = ctx.registry.agents.get(agentId);
  if (agent) agent.axes = after;
  return after;
}

/** What `from` now thinks of `to`, after observing one outcome (1 = met the floor, 0 = did not). */
export async function updatePairwiseTrust(
  ctx: EngineContext,
  args: { from: string; to: string; sample: number; reason: string; parent_event_id?: string | null },
): Promise<number> {
  const key = pairKey(args.from, args.to);
  const before = ctx.registry.pairwise.get(key) ?? null;
  const after = ema(before, args.sample);
  await upsertPairwise(ctx.db, { from: args.from, to: args.to, category: ctx.request.category, trust: after });
  ctx.registry.pairwise.set(key, after);
  await ctx.ledger.append({
    type: "axes_updated",
    agent_id: args.from,
    parent_event_id: args.parent_event_id ?? null,
    payload: {
      category: ctx.request.category,
      kind: "trust_pairwise",
      from: args.from,
      to: args.to,
      reason: args.reason,
      before,
      after,
      alpha: EMA_ALPHA,
    },
  });
  return after;
}

/** `underwriting = clamp(delivered / max(promised, ε), 0, 1)` */
export function underwritingSample(delivered: number, promised: number): number {
  return clamp01(delivered / Math.max(promised, 1e-6));
}

/** `latency = 1 − clamp(observed / promised_deadline, 0, 1)` — slack against the deadline the hop accepted. */
export function latencySample(observedS: number, deadlineS: number): number {
  if (deadlineS <= 0) return observedS > 0 ? 0 : 1;
  return 1 - clamp01(observedS / deadlineS);
}

/** `cost_honesty = 1 − clamp(observed_cost / promised_budget, 0, 1)` */
export function costHonestySample(observedCost: number, promisedBudget: number): number {
  if (promisedBudget <= 0) return observedCost > 0 ? 0 : 1;
  return 1 - clamp01(observedCost / promisedBudget);
}
