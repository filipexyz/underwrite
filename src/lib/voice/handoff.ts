/**
 * Voice brief → marketplace request.
 *
 * The last step of the composer: what the agent agreed to out loud becomes a real `Request`, and the
 * auction starts by itself. "Fully automatic" is the requirement, so there is no confirmation screen
 * between the conversation and the market — the human hears the summary and sellers are already
 * bidding.
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
import { DEFAULT_VOICE_CATEGORY, type VoiceTaskBrief } from "./types";

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

export function voiceBriefToRequestInput(brief: VoiceTaskBrief): RequestInput {
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
    category: brief.category ?? DEFAULT_VOICE_CATEGORY,
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
): Promise<{ requestId: string; created: boolean }> {
  const [current] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, args.session.id)).limit(1);
  if (current?.requestId) return { requestId: current.requestId, created: false };

  const input = voiceBriefToRequestInput(args.brief);
  const row = await createRequest(db, input, {
    // The agent composed and filed this, not the person. Recording `agent` keeps the request free of
    // post-hoc human events, so `human_interventions` stays meaningful after `request_received`.
    actor: "agent",
    source: "voice-composer",
    buyerWalletId: args.session.userId,
    category: input.category,
  });

  return { requestId: row.requestId, created: true };
}
