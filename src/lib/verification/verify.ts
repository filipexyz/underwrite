/**
 * Verification (CONTRACTS.md §4): checks → verdict → judges → confidence.
 *
 * Order of authority: checks take precedence over judges. For a verifiable
 * deliverable the check *is* the verdict; judges are consulted when the checks
 * are inconclusive (they decide) or when they pass (independent agreement as a
 * confidence signal). Nobody pays judges to confirm a failed artifact.
 */
import type { Verdict, Verification, VerificationSpec } from "@/lib/contracts";
import { verifications, type VerificationRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { PdfArtifact, SourceDocument } from "@/lib/marketplace/artifact";
import type { EngineContext } from "@/lib/marketplace/context";
import type { RegistryAgent } from "@/lib/marketplace/registry";
import { runChecks } from "./checks";
import { computeConfidence, processSignal } from "./confidence";
import { inspectArtifact } from "./inspect";
import { runJudges, type JudgingResult } from "./judges";

export type VerificationOutcome = {
  verification: Verification;
  row: VerificationRow;
  /** Weighted pass ratio of the deterministic checks (feeds the `execution` axis). */
  objective: number | null;
  judging: JudgingResult;
  check_event_ids: string[];
  /** Under the hard rule: pass, floor met by the caller's escrow, and judges in agreement. */
  sla_verdict: Verdict;
};

/** Track record = the producer's observed `execution` in this category, else its global trust. */
export function trackRecordOf(agent: RegistryAgent): number {
  return agent.axes.execution ?? agent.trust_global;
}

export async function verifyArtifact(
  ctx: EngineContext,
  args: {
    artifact: PdfArtifact;
    source: SourceDocument;
    producer: RegistryAgent;
    chainAgentIds: string[];
    planId: string;
    spec: VerificationSpec;
    artifactEventId: string | null;
  },
): Promise<VerificationOutcome> {
  const facts = await inspectArtifact(args.artifact);
  const result = runChecks(args.spec, facts, args.source);

  const checkEventIds: string[] = [];
  for (const check of result.checks) {
    const event = await ctx.ledger.append({
      type: "check_run",
      agent_id: null,
      parent_event_id: args.artifactEventId,
      payload: {
        check_id: check.check_id,
        name: check.name,
        passed: check.passed,
        weight: check.weight,
        detail: check.detail,
        artifact_ref: facts.artifact_ref,
        producer_agent_id: args.producer.agentId,
        rubric_version: args.spec.rubric_version,
      },
    });
    checkEventIds.push(event.event_id);
  }

  let verdict: Verdict;
  if (!result.conclusive || result.objective === null) verdict = "inconclusive";
  else verdict = result.objective >= args.spec.required_passing ? "pass" : "fail";

  let judging: JudgingResult = { judges: [], agreement: null, judges_disagree: false, event_ids: [], skipped: [] };
  if (verdict !== "fail") {
    judging = await runJudges(ctx, {
      producer: args.producer,
      chainAgentIds: args.chainAgentIds,
      facts,
      source: args.source,
      spec: args.spec,
      parentEventId: args.artifactEventId,
    });
    if (verdict === "inconclusive" && judging.judges.length > 0) {
      const all = new Set(judging.judges.map((j) => j.verdict));
      verdict = all.size === 1 ? judging.judges[0].verdict : "inconclusive";
    }
  }

  const confidence = computeConfidence({
    objective: result.objective,
    agreement: judging.agreement,
    track_record: trackRecordOf(args.producer),
    process: processSignal(facts.observed_latency_ms, facts.declared_latency_ms),
    self_report: args.artifact.self_report,
  });

  const verification: Verification = {
    verification_id: newId("ver"),
    request_id: ctx.request.requestId,
    artifact_ref: facts.artifact_ref,
    producer_agent_id: args.producer.agentId,
    checks: result.checks,
    confidence,
    verdict,
    judges: judging.judges,
    judges_disagree: judging.judges_disagree,
  };

  const [row] = await ctx.db
    .insert(verifications)
    .values({
      verificationId: verification.verification_id,
      requestId: verification.request_id,
      planId: args.planId,
      producerAgentId: verification.producer_agent_id,
      artifactRef: verification.artifact_ref,
      checks: verification.checks,
      confidence: verification.confidence,
      verdict: verification.verdict,
      judges: verification.judges,
      judgesDisagree: verification.judges_disagree,
    })
    .returning();

  return {
    verification,
    row,
    objective: result.objective,
    judging,
    check_event_ids: checkEventIds,
    sla_verdict: judging.judges_disagree ? "fail" : verdict,
  };
}
