/**
 * Confidence, method `hardcoded_v0` (PRODUCT.md):
 *
 *   confidence = w1·objective + w2·agreement + w3·track_record + w4·process
 *              + w_self·self_report − penalty(divergence)
 *
 * - Weights are hardcoded and versioned; recalibration is a later step.
 * - The producer never scores itself: `self_report` is capped at 0.10 and a
 *   self-report above the objective signal is charged a divergence penalty.
 * - A missing signal hands its weight to the strongest signal present
 *   (objective → agreement → track record), so "the weight of objective grows"
 *   when judges are not consulted and checks are conclusive.
 */
import type { ConfidenceBreakdown } from "@/lib/contracts";

export type ConfidenceSignals = {
  objective: number | null;
  agreement: number | null;
  track_record: number | null;
  process: number | null;
  self_report: number | null;
};

type CoreSignal = Exclude<keyof ConfidenceSignals, "self_report">;

export const CONFIDENCE_V0 = {
  method: "hardcoded_v0" as const,
  weights: {
    objective: 0.45,
    agreement: 0.2,
    track_record: 0.2,
    process: 0.05,
  } satisfies Record<CoreSignal, number>,
  /** Capped weight of the producer's own claim. */
  self_report_weight: 0.1,
  /** Charged per unit of `self_report − objective` when the claim exceeds the evidence. */
  divergence_penalty: 0.18,
  precedence: ["objective", "agreement", "track_record", "process"] as const satisfies readonly CoreSignal[],
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function computeConfidence(signals: ConfidenceSignals): ConfidenceBreakdown {
  const { weights, self_report_weight, divergence_penalty, precedence } = CONFIDENCE_V0;

  const present = precedence.filter((k) => signals[k] !== null);
  const orphanWeight = precedence.filter((k) => signals[k] === null).reduce((sum, k) => sum + weights[k], 0);

  let core = 0;
  if (present.length > 0) {
    const anchor = present[0];
    for (const k of present) {
      const w = weights[k] + (k === anchor ? orphanWeight : 0);
      core += w * (signals[k] as number);
    }
  }

  // Core weights sum to 1 − w_self; renormalise when either side is missing so
  // the blend stays a weighted mean of whatever evidence exists.
  const coreWeight = present.length > 0 ? 1 - self_report_weight : 0;
  const selfWeight = signals.self_report !== null ? self_report_weight : 0;
  const denominator = coreWeight + selfWeight;
  const blended = denominator > 0 ? (core + selfWeight * (signals.self_report ?? 0)) / denominator : 0;

  let penalty = 0;
  if (signals.self_report !== null && signals.objective !== null && signals.self_report > signals.objective) {
    penalty = divergence_penalty * (signals.self_report - signals.objective);
  }

  return {
    objective: signals.objective === null ? null : round4(signals.objective),
    agreement: signals.agreement === null ? null : round4(signals.agreement),
    track_record: signals.track_record === null ? null : round4(signals.track_record),
    process: signals.process === null ? null : round4(signals.process),
    self_report: signals.self_report === null ? null : round4(signals.self_report),
    computed: round4(clamp01(blended - penalty)),
    method: CONFIDENCE_V0.method,
  };
}

/** Process signal (v0): how late the producer was against its own declared latency. */
export function processSignal(observedMs: number, declaredMs: number): number {
  if (declaredMs <= 0) return 1;
  const overrun = (observedMs - declaredMs) / declaredMs;
  return round4(1 - clamp01(overrun));
}
