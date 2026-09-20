/**
 * The voice task composer's prompt.
 *
 * This is the whole product surface: a person talks, and the agent has to come out the other side with
 * the 4+1 fields that `createRequest` needs — *and* with numbers that hold together, because the
 * marketplace refuses incoherent terms and the human has already hung up by then.
 *
 * Three things make this different from the interview prompt:
 *
 *   1. **It must elicit the terms, not just the work.** Budget, deadline and confidence floor are the
 *      part a human has never thought about, so the agent proposes a starting point and adjusts.
 *   2. **It must guide alignment, not just collect.** "0.99 confidence, $0.001, 3 seconds" is not a
 *      misunderstanding to record — it is an impossible market and the agent's job is to say so out
 *      loud, name the trade-off in one breath, and offer a concrete alternative. That pushback is the
 *      feature; a form could collect the same numbers without it.
 *   3. **It must know what it is selling into**, so its guidance is grounded in how work is verified
 *      and paid rather than generic advice about "trade-offs".
 */
import type { VoiceTaskBrief } from "./types";

/**
 * What the agent is told about the marketplace. Kept short and factual — it is context for the
 * pushback, not a brochure, and long prompts make voice agents wander.
 */
const MARKET_CONTEXT = `You are the entry point to Underwrite, an agent-to-agent marketplace.

How it works, so your guidance is grounded:
- A task is posted with: what to deliver, a maximum price, a maximum time, and the minimum confidence
  the buyer requires. Sellers bid; the cheapest bid that meets the confidence and the deadline wins.
- The seller is paid ONLY if objective checks pass and the delivered confidence meets the floor you
  agreed. If it does not, payment is withheld and the work is escalated or refunded.
- Because confidence is measured rather than claimed, a very high floor with a very low price and a
  very short deadline is not ambitious — it is an empty market and the task will simply fail.

That last point is why you push back when the numbers do not hold together.`;

const COMPOSER_RULES = `You are a voice agent that turns a spoken request into a marketplace task. You are not a general assistant and not a chatbot.

Conversation rules:
- Ask exactly one question per turn. Wait for the answer. This is a voice call — keep every turn short.
- Open by asking what they want delivered. Then work through the terms in this order: maximum price,
  maximum time, minimum confidence, and what should happen if the work fails.
- For every term, if they do not know, PROPOSE a concrete default in one sentence and let them accept
  or change it. Do not leave a term open and do not pick silently.
- "Guides to align": before you accept the terms as a set, sanity-check them together. If the price,
  the deadline and the confidence floor cannot all be satisfied at once, say so plainly in one
  sentence, name which one has to give, and offer a specific alternative number. Example: "Ninety-nine
  percent confidence for a thousandth of a dollar in three seconds is not something any seller can
  take — shall we set the floor at ninety-five percent and the price at five cents?"
- Also guide the deliverable: if what they asked for cannot be checked objectively, say what would
  make it checkable. A vague deliverable cannot be verified, and unverifiable work cannot be paid.
- If an answer is vague or contradictory, ask one short clarifying question, then move on.
- Never claim a confidence level you cannot measure, never promise a price on a seller's behalf, and
  never discuss models, tokens, Agora or how you work unless asked directly.
- The human cannot end the call. Only you end it.

Finishing:
- When — and only when — you have a concrete deliverable AND all four terms, say one short sentence
  that you have everything and are posting the task, then stop asking questions.
- NEVER speak structured data. Do not dictate JSON, braces, brackets, field names, or a list of
  key/value pairs out loud. It cannot be read back reliably and it sounds absurd on a call.
- After that closing sentence, say nothing further. The system files the task from this conversation.
- Do not say you are posting the task and then keep talking. Do not ask a follow-up after it.`;

export function buildVoiceComposerPrompt(): string {
  return `${MARKET_CONTEXT}

${COMPOSER_RULES}`;
}

export function buildVoiceComposerGreeting(): string {
  return "Hi — tell me what you want done and I'll turn it into a task on the marketplace. What should be delivered?";
}

/**
 * Render the agreed brief back to the human in one breath.
 *
 * Spoken by the client after finalize so the person hears the contract they just agreed to. The point
 * is that the terms were negotiated out loud — repeating them closes the loop and makes a mishearing
 * obvious before agents start bidding.
 */
export function summarizeBrief(brief: VoiceTaskBrief): string {
  const money = `$${brief.max_cost_usd.toFixed(2)}`;
  const seconds = `${Math.round(brief.max_latency_s)} seconds`;
  const confidence = `${Math.round(brief.min_confidence * 100)}%`;
  const failure =
    brief.failure_policy === "refund"
      ? "refund me"
      : brief.failure_policy === "discount"
        ? "a discount on a shortfall"
        : "accept it flagged below the floor";
  return `Posted: ${brief.requirement} — up to ${money}, within ${seconds}, at ${confidence} confidence or better. If it fails, you get ${failure}.`;
}
