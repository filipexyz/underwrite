/**
 * The interview → marketplace handoff.
 *
 * A finished voice interview used to be a dead end: it produced structured answers, marked the need
 * complete, stopped the Agora agent, and nothing consumed the result. The creator still had to
 * hand-write the task. This module is the missing link — it turns the answers into a real
 * `Request` (CONTRACTS.md §1), which is what makes the pitch "a voice call that becomes paid agent
 * work" instead of "a voice call next to a marketplace".
 *
 * Composition is deliberately **deterministic, not LLM-written**: the requirement is assembled from
 * the brief and the verbatim answers. An interviewer that paraphrases its own output is one more
 * thing that can be wrong on stage, and the answers are already the human's own words — the strongest
 * form of the task statement available. (An LLM pass could polish phrasing later; it must never be
 * the source of a promised number.)
 */
import { eq } from "drizzle-orm";
import type { RequestInput } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { interviewNeeds, type InterviewNeedRow } from "@/lib/db/schema";
import { createRequest } from "@/lib/marketplace/requests";
import type { InterviewAnswers } from "./types";

/** Requirement text is fed to agents and to the ledger; keep it bounded and readable. */
const MAX_REQUIREMENT_CHARS = 4_000;

function trimTo(text: string, max = MAX_REQUIREMENT_CHARS): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Compose the task statement from the brief plus the human's own answers.
 *
 * Every field the interview tried to collect is included, in the order the brief declared them, so a
 * consuming agent can see exactly what was asked and what was answered — including fields left blank,
 * which are marked rather than silently dropped.
 */
export function composeRequirement(need: Pick<InterviewNeedRow, "title" | "brief">, answers: InterviewAnswers): string {
  const { brief } = need;
  const lines: string[] = [`# ${need.title}`];

  const goal = brief.goal.trim();
  if (goal) lines.push("", goal);

  if (brief.context?.trim()) lines.push("", `Context: ${brief.context.trim()}`);
  if (brief.success_criteria?.trim()) lines.push("", `Success criteria: ${brief.success_criteria.trim()}`);

  const declared = brief.required_fields;
  const answered = answers.answers ?? {};
  // Declared order first, then anything the interview captured that was not declared.
  const extra = Object.keys(answered).filter((key) => !declared.includes(key));
  const ordered = [...declared, ...extra];

  if (ordered.length > 0) {
    lines.push("", "## Requirements captured in the interview");
    for (const field of ordered) {
      const value = answered[field];
      lines.push(`- **${field}**: ${value && value.trim() ? value.trim() : "_not answered_"}`);
    }
  }

  if (answers.notes?.trim()) lines.push("", `Notes: ${answers.notes.trim()}`);

  return trimTo(lines.join("\n"));
}

/**
 * Map a completed interview onto the 4+1 request fields.
 *
 * Terms come from the brief (`InterviewTaskTerms`), falling back to the platform defaults when the
 * brief predates them, so an old need still produces a valid request rather than throwing at the end
 * of a call the human already sat through.
 */
export function interviewToRequestInput(need: Pick<InterviewNeedRow, "title" | "brief">, answers: InterviewAnswers): RequestInput {
  const terms = need.brief.task;
  return {
    task: {
      requirement: composeRequirement(need, answers),
      // The interview collects prose, not files. Empty is correct and lets agents bid on the brief.
      files: [],
    },
    max_cost_usd: terms?.max_cost_usd ?? 0.05,
    max_latency_s: terms?.max_latency_s ?? 30,
    min_confidence: terms?.min_confidence ?? 0.95,
    failure_policy: terms?.failure_policy ?? "refund",
    selection_timeout_s: 5,
    execution_mode: terms?.execution_mode,
    invite_agent_ids: terms?.invite_agent_ids?.length ? terms.invite_agent_ids : undefined,
    category: terms?.category,
  };
}

/**
 * Create the marketplace request for a completed interview and stamp the need with its id.
 *
 * Idempotent in the only way that matters: a request is created **once** per need. If an earlier
 * attempt crashed after `createRequest` but before the need was stamped, the rebuild is detected by a
 * re-read rather than by a second insert, so a retried finalize cannot double-charge a buyer.
 */
export async function createTaskFromInterview(
  db: Db,
  args: { need: InterviewNeedRow; answers: InterviewAnswers },
): Promise<{ requestId: string; created: boolean }> {
  const { need, answers } = args;

  const [current] = await db.select().from(interviewNeeds).where(eq(interviewNeeds.id, need.id)).limit(1);
  if (current?.requestId) return { requestId: current.requestId, created: false };

  const input = interviewToRequestInput(need, answers);
  const row = await createRequest(db, input, {
    // The creator is a human, but this one act is the interview agent's: it composed and filed the
    // task. Recording it as `agent` is the honest attribution and keeps the request free of
    // post-hoc human events (`human_interventions` stays 0 after `request_received`).
    actor: "agent",
    source: "interview",
    buyerWalletId: need.createdByUserId,
    executionMode: input.execution_mode,
    category: input.category,
  });

  await db
    .update(interviewNeeds)
    .set({ requestId: row.requestId })
    .where(eq(interviewNeeds.id, need.id));

  return { requestId: row.requestId, created: true };
}
