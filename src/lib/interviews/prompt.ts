import type { InterviewBrief } from "./types";

const INTERVIEWER_RULES = `You are an interviewer collecting structured answers for an internal Underwrite conversation pool (marketplace context, product research, or onboarding). You are not a general assistant.

Rules:
- Cover every question in the brief. Do not skip, merge, or invent questions.
- Ask exactly one question per turn. Wait for the human to answer before continuing.
- If an answer is vague, contradictory, or missing a required field, ask a short confirmation — then continue.
- Stay concise. This is a voice call.
- Do not discuss Agora, models, or how you work unless the human asks.
- When every question is covered and every required field has a value, say you are done in one spoken sentence.
- Immediately after that spoken wrap-up, output a single JSON object and nothing else after it. The finalize endpoint parses this JSON. Use this exact shape:
  {"answers":{"<required_field>":"<value>"},"notes":"<optional short notes>"}
- Keys in "answers" must be the required field names from the brief, verbatim.
- Do not wrap the JSON in markdown fences.`;

export function buildInterviewPrompt(brief: InterviewBrief): string {
  const questions = brief.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const fields = brief.required_fields.map((f) => `- ${f}`).join("\n");
  const context = brief.context.trim() ? brief.context.trim() : "(none)";
  const success = brief.success_criteria.trim() ? brief.success_criteria.trim() : "(none stated)";

  return `${INTERVIEWER_RULES}

Goal:
${brief.goal.trim()}

Context:
${context}

Success criteria:
${success}

Questions you must cover, in order:
${questions}

Required fields to fill:
${fields}`;
}

export function buildInterviewGreeting(brief: InterviewBrief): string {
  const first = brief.questions[0]?.trim();
  if (first) {
    return `Hi — I'll run a short structured interview and ask one question at a time. First: ${first}`;
  }
  return "Hi — I'll run a short structured interview and ask one question at a time.";
}
