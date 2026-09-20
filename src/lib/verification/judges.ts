/**
 * Judges J1/J2 (ARCHITECTURE.md §7). Fixed, registered, with skin in the game.
 *
 * Independence is enforced, not assumed: a judge must be from a different
 * model family than the producer and outside the chain it judges (invariant 7).
 * The rubric is blind — judges see TASK_SPEC + artifact facts + applicable
 * checks, never the producer's reasoning or self-report. Out-of-scope
 * criteria are invisible. Disagreement is signal: it lowers `agreement` and
 * marks the SLA as not met.
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

function applicableIds(spec: VerificationSpec): Set<string> {
  return new Set(spec.checks.map((c) => c.check_id));
}

function kindLabel(kind: ArtifactFacts["kind"]): string {
  if (kind === "html") return "HTML";
  if (kind === "md") return "Markdown";
  if (kind === "zip") return "ZIP";
  return "PDF";
}

/**
 * What a blind judge concludes from the facts. Deterministic on purpose:
 * NeuraLake text is rationale, never control flow.
 * J2 may stay stricter on in-scope PDF fonts only (html_to_pdf / fonts_embedded);
 * it never invents out-of-scope criteria.
 */
export function judgeFacts(
  judge: RegistryAgent,
  facts: ArtifactFacts,
  source: SourceDocument,
  spec: VerificationSpec,
  category?: string,
): { verdict: Verdict; reasons: string[] } {
  const applicable = applicableIds(spec);
  const reasons: string[] = [];
  const asksValid = [...applicable].some((id) => id === "artifact_renders" || id === "artifact_exists" || id.endsWith("_valid"));
  if (asksValid && !facts.valid) {
    return { verdict: "inconclusive", reasons: [`artifact is not readable ${kindLabel(facts.kind)}`] };
  }
  if (applicable.has("no_layout_overflow") && facts.overflow_regions > 0) {
    reasons.push(`${facts.overflow_regions} overflowing region(s)`);
  }
  if (applicable.has("text_matches_source")) {
    const coverage = textCoverage(source.text, facts.text);
    if (coverage < TEXT_COVERAGE_THRESHOLD) reasons.push(`only ${(coverage * 100).toFixed(1)}% of the source text is present`);
  }
  const fontsInScope = facts.kind === "pdf" && (applicable.has("fonts_embedded") || category === "html_to_pdf");
  if (judge.agentId.startsWith("j2") && fontsInScope && !facts.fonts_embedded) {
    reasons.push("fonts are not embedded");
  }
  if (applicable.has("has_title") && !facts.title?.trim()) reasons.push("missing title");
  if (applicable.has("has_primary_cta") && facts.cta_selectors_found.length === 0) reasons.push("no primary CTA");
  if (applicable.has("viewport_meta") && !facts.has_viewport_meta) reasons.push("missing viewport meta");
  if (applicable.has("has_sources_section") && !facts.has_sources_section) reasons.push("no sources section");
  if (applicable.has("has_structure") && facts.sections.length < 2) reasons.push("report lacks structure");
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
    taskRequirement?: string;
    category?: string;
  },
): Promise<JudgingResult> {
  const verdicts: JudgeVerdict[] = [];
  const eventIds: string[] = [];
  const skipped: JudgingResult["skipped"] = [];
  const category = args.category ?? ctx.request.category;
  const taskRequirement = args.taskRequirement ?? ctx.request.requirement;

  for (const judge of judgesFor(ctx.registry, category)) {
    if (judge.modelFamily === args.producer.modelFamily) {
      skipped.push({ judge_id: judge.agentId, reason: `same model family as producer (${judge.modelFamily})` });
      continue;
    }
    if (args.chainAgentIds.includes(judge.agentId)) {
      skipped.push({ judge_id: judge.agentId, reason: "judge is part of the judged chain" });
      continue;
    }

    const { verdict, reasons } = judgeFacts(judge, args.facts, args.source, args.spec, category);
    const applicable = args.spec.checks.map((c) => `- ${c.check_id} (w=${c.weight}): ${c.description}`).join("\n");
    const structural =
      verdict === "pass"
        ? "PASS — the artifact satisfies every applicable check I can observe."
        : `${verdict.toUpperCase()} — ${reasons.join("; ")}.`;
    const factsLine = [
      `kind=${args.facts.kind}`,
      `valid=${args.facts.valid}`,
      `pages=${args.facts.pages}`,
      `overflow_regions=${args.facts.overflow_regions}`,
      `fonts_embedded=${args.facts.fonts_embedded}`,
      `links=${args.facts.links.length}`,
      `text_chars=${args.facts.text.length}`,
      `word_count=${args.facts.word_count}`,
      `title=${args.facts.title ?? ""}`,
      `cta=${args.facts.cta_selectors_found.length}`,
      `zip_entries=${args.facts.zip_entries.join("|")}`,
      `source_chars=${args.source.text.length}`,
    ].join(", ");
    const inference = await runInference({
      agent_id: judge.agentId,
      purpose: "judge",
      system: `You are an independent verification judge (rubric ${args.spec.rubric_version}). You receive TASK_SPEC, ARTIFACT_FACTS, and APPLICABLE_CHECKS only. Out-of-scope criteria: do not reason about them, do not fail on them, and do not mention them. The structural verdict is already decided from artifact facts; write one sentence of rationale only.`,
      prompt: `TASK_SPEC:\n${taskRequirement}\n\nAPPLICABLE_CHECKS:\n${applicable}\n\nARTIFACT_FACTS: ${factsLine}\n\nStructural verdict (decisions stay rule-based): ${structural}`,
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
        rationale: inference.text || structural,
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
