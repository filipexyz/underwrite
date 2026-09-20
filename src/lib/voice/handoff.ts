/**
 * Voice brief → marketplace request.
 *
 * The last step of the composer: what the agent agreed to out loud becomes a real `Request` on the
 * locked **push** path (Top-K hireable agents for the classified specialty — same as the hosted
 * agent test area). "Fully automatic" is the requirement, so there is no confirmation screen
 * between the conversation and the market — the human hears the summary and sellers are already
 * being invited.
 *
 * The requirement text is composed **deterministically** from the brief. The agent negotiated the
 * numbers in conversation, but the artefact agents bid on must be reproducible and must not depend on
 * a second model pass paraphrasing what the first one heard.
 */
import { eq } from "drizzle-orm";
import type { RequestInput } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { voiceSessions, type VoiceSessionRow } from "@/lib/db/schema";
import { createRequest } from "@/lib/marketplace/requests";
import { classifyRequirementHeuristic, classifyTask, type TaskClassification } from "@/lib/typesafe/classify";
import type { VoiceTaskBrief } from "./types";

const MAX_REQUIREMENT_CHARS = 4_000;

function failurePolicyText(brief: VoiceTaskBrief): string {
  switch (brief.failure_policy) {
    case "refund":
      return "If the SLA is missed, refund the buyer.";
    case "discount":
      return "If the SLA is missed, settle at a discount rather than refunding.";
    default:
      return "If the SLA is missed, accept the delivery flagged as below the floor.";
  }
}

/**
 * Turn the agreed brief into the task statement agents will read.
 *
 * States the requirement first, then the terms as explicit numbers, because they are the contract: the
 * seller is paid only if the delivered confidence meets the floor inside the deadline and the price.
 * Every term the human agreed to is echoed, so a mishearing is visible in the artefact and not only in
 * the audio.
 */
export function composeVoiceRequirement(brief: VoiceTaskBrief): string {
  const lines = [
    brief.requirement.trim(),
    "",
    "## Agreed terms",
    `- Maximum price: $${brief.max_cost_usd.toFixed(2)}`,
    `- Maximum time: ${brief.max_latency_s} seconds`,
    `- Minimum confidence: ${Math.round(brief.min_confidence * 100)}%`,
    `- ${failurePolicyText(brief)}`,
  ];
  if (brief.notes?.trim()) lines.push("", `Notes: ${brief.notes.trim()}`);
  const text = lines.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.length <= MAX_REQUIREMENT_CHARS ? text : `${text.slice(0, MAX_REQUIREMENT_CHARS - 1).trimEnd()}…`;
}

/**
 * Classify the requirement, then build the request.
 *
 * Replaces the hardcoded `DEFAULT_VOICE_CATEGORY`: the category decides which rubric judges the work, and
 * defaulting it meant a landing page was graded by the PDF report rubric and could never pass.
 *
 * The classification is a cost line like any other model call, so it is returned rather than dropped — the
 * efficiency numbers should include the decision that shaped the task.
 */
export async function voiceBriefToRequestInputClassified(
  brief: VoiceTaskBrief,
): Promise<{ input: RequestInput; classification: TaskClassification }> {
  const classification = await classifyTask(brief.requirement);
  return { input: voiceBriefToRequestInput(brief, classification.category), classification };
}

export function voiceBriefToRequestInput(brief: VoiceTaskBrief, category?: string): RequestInput {
  return {
    task: {
      requirement: composeVoiceRequirement(brief),
      // A spoken request has no attachments. Empty is correct and lets sellers bid on the brief.
      files: [],
    },
    max_cost_usd: brief.max_cost_usd,
    max_latency_s: brief.max_latency_s,
    min_confidence: brief.min_confidence,
    failure_policy: brief.failure_policy,
    selection_timeout_s: 5,
    execution_mode: "push",
    category: brief.category ?? category ?? classifyRequirementHeuristic(brief.requirement),
  };
}

/**
 * Create the request for a finished conversation.
 *
 * Idempotent by re-read: a retried finalize returns the existing `request_id` rather than posting a
 * second task with the same brief, which would charge the buyer twice for one conversation.
 */
export async function createTaskFromVoiceBrief(
  db: Db,
  args: { session: VoiceSessionRow; brief: VoiceTaskBrief },
): Promise<{ requestId: string; created: boolean; category: string; classifySource?: TaskClassification["source"] }> {
  const [current] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, args.session.id)).limit(1);
  if (current?.requestId) {
    return {
      requestId: current.requestId,
      created: false,
      category: args.brief.category ?? classifyRequirementHeuristic(args.brief.requirement),
    };
  }

  // The category decides which rubric judges the work and which Top-K specialty is invited, so it
  // is inferred from the brief. `classifyTask` never throws: unconfigured or unreachable, it uses
  // the keyword heuristic — never a silent html_to_pdf stamp.
  const { input, classification } = await voiceBriefToRequestInputClassified(args.brief);
  const category = input.category ?? classification.category;
  const row = await createRequest(db, input, {
    // The agent composed and filed this, not the person. Recording `agent` keeps the request free of
    // post-hoc human events, so `human_interventions` stays meaningful after `request_received`.
    actor: "agent",
    source: "voice-composer",
    buyerWalletId: args.session.userId,
    category,
    classifySource: classification.source,
    classifyOverride: classification.override,
    // Always push. The seed Mastra html-to-pdf auction must not run here.
    executionMode: "push",
  });

  return { requestId: row.requestId, created: true, category, classifySource: classification.source };
}
