/**
 * Every model call goes through here so tokens, latency and dollars land
 * in the ledger. The live path always calls the configured OpenAI-compatible
 * provider (NeuraLake `model="auto"`). There is no simulated fallback.
 */
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "@/lib/env";
import { costForTokens } from "./pricing";

export const MODEL_PROVIDER_REQUIRED_MESSAGE =
  "Marketplace inference requires MODEL_PROVIDER_API_KEY (aliases: NEURALAKE_API_KEY, OPENAI_API_KEY). Set MODEL_PROVIDER_BASE_URL=https://api.neuralake.cloud/v1 and MODEL_PROVIDER_NAME=neuralake. Simulated inference is disabled.";

export class InferenceNotConfiguredError extends Error {
  readonly code = "model_provider_not_configured" as const;
  readonly httpStatus = 503;
  readonly details: Record<string, unknown>;

  constructor() {
    super(MODEL_PROVIDER_REQUIRED_MESSAGE);
    this.name = "InferenceNotConfiguredError";
    this.details = {
      required: ["MODEL_PROVIDER_API_KEY"],
      aliases: ["NEURALAKE_API_KEY", "OPENAI_API_KEY"],
      base_url: env.modelProvider.baseUrl,
      name: env.modelProvider.name,
      model: env.modelProvider.model,
    };
  }
}

export class InferenceProviderError extends Error {
  readonly code = "model_provider_failed" as const;
  readonly httpStatus = 502;
  readonly details: Record<string, unknown>;

  constructor(purpose: string, agentId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`NeuraLake inference failed for ${agentId}/${purpose}: ${reason}`);
    this.name = "InferenceProviderError";
    this.cause = cause instanceof Error ? cause : undefined;
    this.details = { agent_id: agentId, purpose, reason };
  }
}

export type InferenceResult = {
  text: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

export type InferenceRequest = {
  agent_id: string;
  purpose: string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
};

export type InferenceTransport = (req: {
  model: string;
  system?: string;
  prompt: string;
  maxOutputTokens: number;
  agent_id: string;
  purpose: string;
}) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

let testTransport: InferenceTransport | undefined;
let provider: ReturnType<typeof createOpenAICompatible> | undefined;

/** Test-only HTTP-boundary mock. Production never installs this. */
export function setInferenceTransportForTests(transport: InferenceTransport | undefined): void {
  if (!env.isTest) {
    throw new Error("setInferenceTransportForTests is only available in test processes");
  }
  testTransport = transport;
}

export function requireModelProvider(): {
  enabled: boolean;
  apiKey: string | undefined;
  baseUrl: string;
  name: string;
  model: string;
} {
  if (!env.modelProvider.enabled) throw new InferenceNotConfiguredError();
  return env.modelProvider;
}

function getProvider() {
  const cfg = requireModelProvider();
  provider ??= createOpenAICompatible({
    name: cfg.name,
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey as string,
  });
  return provider;
}

async function liveTransport(req: Parameters<InferenceTransport>[0]) {
  const p = getProvider();
  try {
    const result = await generateText({
      model: p(req.model),
      system: req.system,
      prompt: req.prompt,
      maxOutputTokens: req.maxOutputTokens,
      telemetry: { isEnabled: true, functionId: `${req.agent_id}:${req.purpose}` },
    });
    return {
      text: result.text.trim(),
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  } catch (error) {
    if (error instanceof InferenceNotConfiguredError) throw error;
    throw new InferenceProviderError(req.purpose, req.agent_id, error);
  }
}

export async function runInference(req: InferenceRequest): Promise<InferenceResult> {
  const model = env.modelProvider.model;
  const transport = env.isTest && testTransport ? testTransport : liveTransport;
  if (transport === liveTransport) requireModelProvider();

  const started = performance.now();
  const result = await transport({
    model,
    system: req.system,
    prompt: req.prompt,
    maxOutputTokens: req.maxOutputTokens ?? 200,
    agent_id: req.agent_id,
    purpose: req.purpose,
  });
  const tokens_in = result.inputTokens;
  const tokens_out = result.outputTokens;
  return {
    text: result.text.trim(),
    model,
    tokens_in,
    tokens_out,
    cost_usd: costForTokens(model, tokens_in, tokens_out),
    latency_ms: Math.round(performance.now() - started),
  };
}

export function findInferenceError(error: unknown): InferenceNotConfiguredError | InferenceProviderError | null {
  let current: unknown = error;
  for (let i = 0; i < 8 && current; i += 1) {
    if (current instanceof InferenceNotConfiguredError || current instanceof InferenceProviderError) return current;
    if (current instanceof Error && "cause" in current && current.cause) {
      current = current.cause;
      continue;
    }
    break;
  }
  return null;
}
