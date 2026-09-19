/**
 * Causal walk-back (CONTRACTS.md §7, ARCHITECTURE.md §2).
 *
 * Every hop logged its spec, candidate set, selection rationale and outcome,
 * so when a delivery fails we can name the *decision* that caused it — not
 * the position where it surfaced. The penalty ladder:
 *
 *   bad_selection     → whoever hired (ignored history / paid far below market)
 *   bad_execution     → the executor (blew its own promise)
 *   bad_underwriting  → whoever promised more than its chain could sustain
 *   spec_ambiguous    → nobody (failure without a failing declared check)
 *
 * `spec_ambiguous` never penalizes an axis — otherwise agents learn to sandbag.
 */
import type { Attribution, RootCause, Verification } from "@/lib/contracts";
import { attributions, type AttributionRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { RULES, type EngineContext } from "./context";
import type { CandidateSnapshot } from "./quotes";
import type { HopRecord } from "./types";

/** Thresholds a diligent hirer would have stopped at. */
export const SELECTION_RED_FLAGS = {
  EXECUTION_BELOW: 0.75,
  UNDERWRITING_BELOW: 0.6,
  PRICE_BELOW_MARKET: -0.3,
} as const;

function poorHistory(snapshot: CandidateSnapshot | undefined): string[] {
  if (!snapshot) return [];
  const flags: string[] = [];
  if (snapshot.execution !== null && snapshot.execution < SELECTION_RED_FLAGS.EXECUTION_BELOW) {
    flags.push(`execution ${snapshot.execution.toFixed(2)}`);
  }
  if (snapshot.underwriting !== null && snapshot.underwriting < SELECTION_RED_FLAGS.UNDERWRITING_BELOW) {
    flags.push(`underwriting ${snapshot.underwriting.toFixed(2)}`);
  }
  return flags;
}

export type WalkBack = {
  root_cause: RootCause;
  blamed_agent: string | null;
  explanation: string;
};

export function walkBack(args: {
  hops: HopRecord[];
  failedHopIndex: number;
  verification: Verification;
}): WalkBack {
  const { hops, failedHopIndex, verification } = args;
  const failed = hops[failedHopIndex];
  const hirer = failedHopIndex > 0 ? hops[failedHopIndex - 1] : null;
  const delivered = verification.confidence.computed;
  const failedChecks = verification.checks.filter((c) => !c.passed);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  if (failedChecks.length === 0 && verification.verdict !== "fail") {
    return {
      root_cause: "spec_ambiguous",
      blamed_agent: null,
      explanation: `The delivery failed the SLA without failing a declared check (${
        verification.judges_disagree ? "judges disagreed" : "verdict inconclusive"
      }). The rubric, not an agent, is at fault — returned for clarification, no axis penalized.`,
    };
  }

  const blownPromise = delivered < failed.promised_confidence - RULES.PROMISE_TOLERANCE;
  const defects = `failed checks: ${failedChecks.map((c) => c.check_id).join(", ")}`;

  // `failed.selection` is the evidence the hirer recorded when it picked this hop.
  if (hirer && failed.selection) {
    const sel = failed.selection;
    const snapshot = sel.candidates.find((c) => c.agent_id === failed.agent_id);
    const flags = poorHistory(snapshot);
    const underpriced = sel.price_vs_market !== null && sel.price_vs_market <= SELECTION_RED_FLAGS.PRICE_BELOW_MARKET;
    if (!sel.history_checked && (flags.length > 0 || underpriced)) {
      const price = underpriced ? `${Math.round(Math.abs(sel.price_vs_market as number) * 100)}% below the other quotes` : "the lowest quote";
      const history = flags.length > 0 ? ` — the registry showed ${flags.join(" and ")}` : "";
      return {
        root_cause: "bad_selection",
        blamed_agent: hirer.agent_id,
        explanation: `${hirer.agent_id} hired ${failed.agent_id} at ${price} without consulting its history${history}. ${failed.agent_id} promised ${pct(
          failed.promised_confidence,
        )} and delivered ${pct(delivered)} (${defects}). The failure surfaced at ${failed.agent_id}; the decision that caused it was ${hirer.agent_id}'s.`,
      };
    }
  }

  if (blownPromise) {
    return {
      root_cause: "bad_execution",
      blamed_agent: failed.agent_id,
      explanation: `${failed.agent_id} promised ${pct(failed.promised_confidence)} and delivered ${pct(delivered)} (${defects})${
        hirer ? `; ${hirer.agent_id} selected it after checking its history` : ""
      }. The executor owns this failure.`,
    };
  }

  const top = hops[0];
  return {
    root_cause: "bad_underwriting",
    blamed_agent: top.agent_id,
    explanation: `${top.agent_id} underwrote ${pct(top.promised_confidence)} with a chain that delivered ${pct(
      delivered,
    )} while every hop stayed within its own promise. The promise, not the execution, was wrong.`,
  };
}

export async function emitAttribution(
  ctx: EngineContext,
  args: { hops: HopRecord[]; failedHopIndex: number; verification: Verification; evidenceEventIds: string[]; parentEventId: string | null },
): Promise<{ row: AttributionRow; attribution: Attribution; event_id: string }> {
  const result = walkBack(args);
  const attribution: Attribution = {
    attribution_id: newId("att"),
    request_id: ctx.request.requestId,
    failed_hop: args.hops[args.failedHopIndex].agent_id,
    root_cause: result.root_cause,
    blamed_agent: result.blamed_agent,
    evidence_event_ids: args.evidenceEventIds,
    explanation: result.explanation,
  };
  const [row] = await ctx.db
    .insert(attributions)
    .values({
      attributionId: attribution.attribution_id,
      requestId: attribution.request_id,
      failedHop: attribution.failed_hop,
      rootCause: attribution.root_cause,
      blamedAgent: attribution.blamed_agent,
      evidenceEventIds: attribution.evidence_event_ids,
      explanation: attribution.explanation,
    })
    .returning();
  const event = await ctx.ledger.append({
    type: "attribution_emitted",
    agent_id: attribution.blamed_agent,
    parent_event_id: args.parentEventId,
    payload: { ...attribution },
  });
  return { row, attribution, event_id: event.event_id };
}
