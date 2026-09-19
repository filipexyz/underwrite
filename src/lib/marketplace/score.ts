/**
 * Best-score ranking for the locked marketplace PoC.
 *
 * NOT cheapest-only. A plan is scored on promised confidence, cost (lower
 * better), latency (lower better), and historical trust when we have it.
 */
import { round6 } from "./quotes";

export const SCORE_WEIGHTS = {
  confidence: 0.4,
  cost: 0.25,
  latency: 0.2,
  history: 0.15,
} as const;

export type ScoreConstraints = {
  max_cost_usd: number;
  max_latency_s: number;
  min_confidence: number;
};

export type ScoreInput = {
  price_usd: number;
  promised_confidence: number;
  latency_s: number;
  /** `trust_global` (0..1) when observed history exists; 0.5 if unknown. */
  history: number;
};

export type ScoreBreakdown = {
  score: number;
  parts: {
    confidence: number;
    cost: number;
    latency: number;
    history: number;
  };
  compliant: boolean;
  rejection_reason: string | null;
};

const EPS = 1e-9;

export function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Compliance against the buyer mandate — the plan is the contract. */
export function planCompliance(input: ScoreInput, constraints: ScoreConstraints): string | null {
  const reasons: string[] = [];
  if (input.price_usd > constraints.max_cost_usd + EPS) {
    reasons.push(`price $${input.price_usd} > max $${constraints.max_cost_usd}`);
  }
  if (input.latency_s > constraints.max_latency_s + EPS) {
    reasons.push(`latency ${input.latency_s}s > ${constraints.max_latency_s}s`);
  }
  if (input.promised_confidence < constraints.min_confidence - EPS) {
    reasons.push(`confidence ${input.promised_confidence} < ${constraints.min_confidence}`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

/**
 * Higher is better. Cost and latency are inverted against the buyer's ceiling
 * so a slightly dearer / slower plan can still win on confidence + history.
 */
export function scorePlan(input: ScoreInput, constraints: ScoreConstraints): ScoreBreakdown {
  const rejection = planCompliance(input, constraints);
  const costPart = constraints.max_cost_usd > 0 ? clamp01(1 - input.price_usd / constraints.max_cost_usd) : 0;
  const latencyPart = constraints.max_latency_s > 0 ? clamp01(1 - input.latency_s / constraints.max_latency_s) : 0;
  const parts = {
    confidence: clamp01(input.promised_confidence),
    cost: costPart,
    latency: latencyPart,
    history: clamp01(input.history),
  };
  const score = round6(
    SCORE_WEIGHTS.confidence * parts.confidence +
      SCORE_WEIGHTS.cost * parts.cost +
      SCORE_WEIGHTS.latency * parts.latency +
      SCORE_WEIGHTS.history * parts.history,
  );
  return { score, parts, compliant: rejection === null, rejection_reason: rejection };
}

export type RankedPlan<T> = {
  item: T;
  breakdown: ScoreBreakdown;
};

/** Rank compliant plans by score; ties → higher confidence → lower price → higher history. */
export function rankPlans<T extends ScoreInput>(
  items: T[],
  constraints: ScoreConstraints,
): { ranked: Array<RankedPlan<T>>; winner: RankedPlan<T> | null } {
  const ranked = items
    .map((item) => ({ item, breakdown: scorePlan(item, constraints) }))
    .sort((a, b) => {
      if (a.breakdown.compliant !== b.breakdown.compliant) return a.breakdown.compliant ? -1 : 1;
      return (
        b.breakdown.score - a.breakdown.score ||
        b.item.promised_confidence - a.item.promised_confidence ||
        a.item.price_usd - b.item.price_usd ||
        b.item.history - a.item.history
      );
    });
  const winner = ranked.find((r) => r.breakdown.compliant) ?? null;
  return { ranked, winner };
}

export function defaultHistory(trustGlobal: number | null | undefined): number {
  if (trustGlobal === null || trustGlobal === undefined) return 0.5;
  return clamp01(trustGlobal);
}

/** Sanity: weights sum to 1 so a perfect plan scores 1. */
export const SCORE_WEIGHT_SUM =
  SCORE_WEIGHTS.confidence + SCORE_WEIGHTS.cost + SCORE_WEIGHTS.latency + SCORE_WEIGHTS.history;
