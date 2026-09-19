/**
 * Judges J1/J2 (ARCHITECTURE.md §7). Fixed, registered, with skin in the game.
 *
 * Independence is enforced, not assumed: a judge must be from a different
 * model family than the producer and outside the chain it judges (invariant 7).
 * The rubric is blind — judges see artifact facts + rubric, never the
 * producer's reasoning or self-report. Disagreement is signal: it lowers
 * `agreement` and marks the SLA as not met.
 *
 * The marketplace pays for judging (funded by forfeited stakes + commission).
 */
import type { JudgeVerdict, Verdict, VerificationSpec } from "@/lib/contracts";
import type { SourceDocument } from "@/lib/marketplace/artifact";
import { settleInferenceCost, WALLET, type EngineContext } from "@/lib/marketplace/context";
import { judgesFor, type RegistryAgent } from "@/lib/marketplace/registry";
import { runInference } from "@/lib/observability/inference";
import { textCoverage, TEXT_COVERAGE_THRESHOLD } from "./checks";
import type { ArtifactFacts } from "./inspect";

export type JudgingResult = {
  judges: JudgeVerdict[];
  /** Share of judges agreeing with the majority verdict; `null` when no judge was eligible. */
  agreement: number | null;
  judges_disagree: boolean;
  event_ids: string[];
  skipped: Array<{ judge_id: string; reason: string }>;
};

/**
 * What a blind judge concludes from the facts. Deterministic on purpose:
 * model text is rationale, never control flow (see observability/inference.ts).
 * J2 is the stricter reader (fonts), which is where disagreement can appear.
 */
function judgeFacts(judge: RegistryAgent, facts: ArtifactFacts, source: SourceDocument): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (!facts.valid) return { verdict: "inconclusive", reasons: ["artifact is not a readable PDF"] };
  if (facts.overflow_regions > 0) reasons.push(`${facts.overflow_regions} overflowing region(s)`);
  const coverage = textCoverage(source.text, facts.text);
  if (coverage < TEXT_COVERAGE_THRESHOLD) reasons.push(`only ${(coverage * 100).toFixed(1)}% of the source text is present`);
  if (judge.agentId.startsWith("j2") && !facts.fonts_embedded) reasons.push("fonts are not embedded");
  return { verdict: reasons.length === 0 ? "pass" : "fail", reasons };
}

export async function runJudges(
  ctx: EngineContext,
  args: {
    producer: RegistryAgent;
    chainAgentIds: string[];
    facts: ArtifactFacts;
    source: SourceDocument;
    spec: VerificationSpec;
    parentEventId: string | null;
  },
): Promise<JudgingResult> {
  const verdicts: JudgeVerdict[] = [];
  const eventIds: string[] = [];
  const skipped: JudgingResult["skipped"] = [];

  for (const judge of judgesFor(ctx.registry, ctx.request.category)) {
    if (judge.modelFamily === args.producer.modelFamily) {
      skipped.push({ judge_id: judge.agentId, reason: `same model family as producer (${judge.modelFamily})` });
      continue;
    }
    if (args.chainAgentIds.includes(judge.agentId)) {
      skipped.push({ judge_id: judge.agentId, reason: "judge is part of the judged chain" });
      continue;
    }

    const { verdict, reasons } = judgeFacts(judge, args.facts, args.source);
    const rubric = args.spec.checks.map((c) => `- ${c.check_id} (w=${c.weight}): ${c.description}`).join("\n");
    const inference = await runInference({
      agent_id: judge.agentId,
      model: judge.model,
      purpose: "judge",
      system: `You are an independent verification judge (rubric ${args.spec.rubric_version}). You see only the artifact facts and the rubric. Answer with a verdict and one sentence.`,
      prompt: `Rubric:\n${rubric}\n\nArtifact facts: pages=${args.facts.pages}, overflow_regions=${args.facts.overflow_regions}, fonts_embedded=${args.facts.fonts_embedded}, links=${args.facts.links.length}, text_chars=${args.facts.text.length}, source_chars=${args.source.text.length}.`,
      simulated: judge.policy.judge?.tokens ?? { in: 2000, out: 150 },
      fallbackText:
        verdict === "pass"
          ? "PASS — the artifact satisfies every rubric item I can observe."
          : `${verdict.toUpperCase()} — ${reasons.join("; ")}.`,
      maxOutputTokens: 120,
    });

    const event = await ctx.ledger.append({
      type: "judge_verdict",
      agent_id: judge.agentId,
      model: inference.model,
      tokens_in: inference.tokens_in,
      tokens_out: inference.tokens_out,
      cost_usd: inference.cost_usd,
      latency_ms: inference.latency_ms,
      parent_event_id: args.parentEventId,
      payload: {
        judge_id: judge.agentId,
        model_family: judge.modelFamily,
        producer_agent_id: args.producer.agentId,
        producer_model_family: args.producer.modelFamily,
        verdict,
        reasons,
        rubric_version: args.spec.rubric_version,
        rationale: inference.text,
        simulated: inference.simulated,
        paid_by: WALLET.marketplace,
      },
    });
    await settleInferenceCost(ctx, WALLET.marketplace, inference, event.event_id, `judge_inference:${judge.agentId}`);

    eventIds.push(event.event_id);
    verdicts.push({
      judge_id: judge.agentId,
      model_family: judge.modelFamily,
      verdict,
      rubric_version: args.spec.rubric_version,
    });
  }

  if (verdicts.length === 0) return { judges: [], agreement: null, judges_disagree: false, event_ids: eventIds, skipped };

  const counts = new Map<Verdict, number>();
  for (const v of verdicts) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
  const majority = Math.max(...counts.values());
  return {
    judges: verdicts,
    agreement: Math.round((majority / verdicts.length) * 10_000) / 10_000,
    judges_disagree: counts.size > 1,
    event_ids: eventIds,
    skipped,
  };
}
