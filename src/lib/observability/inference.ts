/**
 * The runner: every model call goes through here so tokens, latency and
 * dollars are captured from line one (build order step 1, D-009).
 *
 * With a model provider configured (`MODEL_PROVIDER_API_KEY` + `MODEL_PROVIDER_BASE_URL`,
 * e.g. NeuraLake's OpenAI-compatible endpoint with `model="auto"`), the call is
 * real and usage comes from the provider. Without one, the call is simulated
 * with the agent's declared token profile so the ledger still carries realistic,
 * deterministic cost lines. Decisions never depend on model output — text is
 * rationale, not control flow.
 */
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@/lib/env";
import type { SimulatedTokens } from "@/lib/marketplace/types";
import { costForTokens } from "./pricing";

export type InferenceResult = {
  text: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  simulated: boolean;
};

export type InferenceRequest = {
  agent_id: string;
  model: string;
  purpose: string;
  system?: string;
  prompt: string;
  /** Token profile used when no provider is configured. */
  simulated: SimulatedTokens;
  /** Deterministic text used when no provider is configured (or the call fails). */
  fallbackText: string;
  /** Latency reported in simulation mode. Defaults to a token-proportional estimate. */
  simulatedLatencyMs?: number;
  maxOutputTokens?: number;
};

let provider: ReturnType<typeof createOpenAICompatible> | undefined;

function getProvider() {
  const cfg = env.modelProvider;
  if (!cfg.enabled) return undefined;
  provider ??= createOpenAICompatible({
    name: cfg.name,
    baseURL: cfg.baseUrl as string,
    apiKey: cfg.apiKey,
  });
  return provider;
}

function simulate(req: InferenceRequest): InferenceResult {
  const tokens_in = req.simulated.in;
  const tokens_out = req.simulated.out;
  return {
    text: req.fallbackText,
    model: req.model,
    tokens_in,
    tokens_out,
    cost_usd: costForTokens(req.model, tokens_in, tokens_out),
    latency_ms: req.simulatedLatencyMs ?? Math.round(120 + tokens_out * 4),
    simulated: true,
  };
}

export async function runInference(req: InferenceRequest): Promise<InferenceResult> {
  const p = getProvider();
  if (!p) return simulate(req);

  const started = performance.now();
  try {
    const result = await generateText({
      model: p(req.model),
      system: req.system,
      prompt: req.prompt,
      maxOutputTokens: req.maxOutputTokens ?? 200,
      telemetry: { isEnabled: true, functionId: `${req.agent_id}:${req.purpose}` },
    });
    const tokens_in = result.usage.inputTokens ?? req.simulated.in;
    const tokens_out = result.usage.outputTokens ?? req.simulated.out;
    return {
      text: result.text.trim() || req.fallbackText,
      model: req.model,
      tokens_in,
      tokens_out,
      cost_usd: costForTokens(req.model, tokens_in, tokens_out),
      latency_ms: Math.round(performance.now() - started),
      simulated: false,
    };
  } catch (error) {
    console.warn(`[inference] ${req.agent_id}/${req.purpose} failed, falling back to simulation:`, error);
    return simulate(req);
  }
}
