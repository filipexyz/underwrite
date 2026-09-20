/**
 * The tool-calling LLM stage for the voice composer.
 *
 * This is the piece Agora's own recipe describes, and its README is explicit about where the tool loop
 * lives:
 *
 *   "Agora cloud never sees a `tool_call` — the tool loop is entirely inside `server/src/llm.py`."
 *
 * So the agent does not speak a brief and it does not call an endpoint over a data channel. Our endpoint
 * **is** the LLM stage: the model asks to call `submit_task`, the call is executed here, in this process,
 * and only the final spoken text goes back. That removes the three hacks that came before it — spoken
 * JSON, phrase matching, and a stall timer doing the real work — and it removes the lie: the agent can
 * only say the task was posted after the tool actually posted it and returned.
 */
import { generateText, stepCountIs, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db/client";
import { submitVoiceBrief } from "./flow";
import { getVoiceSession } from "./store";

/** The provider is shared across requests; building it per call would re-create the client each turn. */
let provider: ReturnType<typeof createOpenAICompatible> | undefined;

function model() {
  if (!env.modelProvider.enabled) throw new Error("model provider is not configured");
  provider ??= createOpenAICompatible({
    name: env.modelProvider.name,
    baseURL: env.modelProvider.baseUrl,
    apiKey: env.modelProvider.apiKey as string,
  });
  return provider(env.modelProvider.model);
}

/**
 * The end tool. Its arguments are the marketplace contract, so the model cannot submit a half-formed
 * task: the same schema the marketplace validates is the schema the model must fill.
 */
export const submitTaskToolName = "submit_task";

const submitTaskSchema = z.object({
  requirement: z.string().describe("What must be delivered, specific enough to be objectively checked."),
  max_cost_usd: z.number().positive().describe("Maximum price the buyer agreed to pay, in US dollars."),
  max_latency_s: z.number().positive().describe("Maximum time the buyer agreed to wait, in seconds."),
  min_confidence: z.number().min(0).max(1).describe("Minimum confidence the buyer requires, as a fraction (95% is 0.95)."),
  failure_policy: z
    .enum(["refund", "discount", "accept_flagged"])
    .describe("What happens if the work fails verification: refund, discount, or accept it flagged."),
  category: z.string().optional().describe("Optional marketplace specialty; selects the verification rubric."),
  notes: z.string().optional(),
});

export type VoiceLlmTurn = { role: "system" | "user" | "assistant"; content: string };

export type VoiceLlmResult = {
  /** Final assistant text, i.e. what Agora's TTS should speak. */
  text: string;
  /** Set once the end tool has run, so the caller can tell the UI (and the person) the truth. */
  request_id: string | null;
  /** True when the tool ran on this turn. */
  submitted: boolean;
};

/**
 * Run one conversational turn with the end tool available.
 *
 * `maxSteps` gives the model room to call the tool and then speak about the result in the same request,
 * which is what makes "the task is posted" a statement the agent has actually earned.
 */
export async function runVoiceLlmTurn(args: {
  sessionId: string;
  userId: string;
  turns: VoiceLlmTurn[];
}): Promise<VoiceLlmResult> {
  const { db } = await getDb();
  const session = await getVoiceSession(db, args.sessionId, args.userId);
  if (!session) throw new Error(`voice session not found: ${args.sessionId}`);

  let requestId: string | null = session.requestId;
  let submitted = false;

  const result = await generateText({
    model: model(),
    messages: args.turns,
    // Let the model call the tool and then speak about the result in the same request.
    stopWhen: stepCountIs(3),
    tools: {
      [submitTaskToolName]: tool({
        description:
          "Submit the agreed task to the marketplace. Call this once — and only once — you have the deliverable and all four terms. After calling it, tell the person briefly that the task is posted.",
        inputSchema: submitTaskSchema,
        execute: async (input) => {
          // The tool runs here, in our process, against our own data. That is the whole point of hosting
          // the LLM stage: no data channel, no narration, no inference of intent from wording.
          const submittedTask = await submitVoiceBrief(db, { session, brief: input });
          requestId = submittedTask.requestId;
          submitted = true;
          return {
            ok: true,
            request_id: submittedTask.requestId,
            created: submittedTask.created,
            summary: submittedTask.summary,
          };
        },
      }),
    },
  });

  return { text: result.text.trim(), request_id: requestId, submitted };
}
