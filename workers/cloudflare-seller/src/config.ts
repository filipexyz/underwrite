/** Defaults match Underwrite `src/lib/env.ts` / PR #9 (NeuraLake, model=auto). */
export const NEURALAKE_DEFAULT_BASE_URL = "https://api.neuralake.cloud/v1";
export const NEURALAKE_DEFAULT_MODEL = "auto";
export const UNDERWRITE_WEBHOOK_STUB_SECRET = "underwrite-webhook-stub";

export type SellerConfig = {
  underwriteBaseUrl: string;
  sellerApiKey: string;
  webhookSecret: string;
  neuralakeBaseUrl: string;
  neuralakeApiKey: string;
  neuralakeModel: string;
  instanceName: string;
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function readSellerConfig(env: Env): SellerConfig {
  const underwriteBaseUrl = trimSlash(env.UNDERWRITE_BASE_URL || "http://localhost:3000");
  const neuralakeBaseUrl = trimSlash(env.NEURALAKE_BASE_URL || NEURALAKE_DEFAULT_BASE_URL);
  return {
    underwriteBaseUrl,
    sellerApiKey: (env.UNDERWRITE_SELLER_API_KEY ?? "").trim(),
    webhookSecret: (env.UNDERWRITE_WEBHOOK_SECRET ?? "").trim() || UNDERWRITE_WEBHOOK_STUB_SECRET,
    neuralakeBaseUrl,
    neuralakeApiKey: (env.NEURALAKE_API_KEY ?? "").trim(),
    neuralakeModel: (env.NEURALAKE_MODEL ?? "").trim() || NEURALAKE_DEFAULT_MODEL,
    instanceName: sanitizeInstanceName(env.SELLER_INSTANCE_NAME || "default"),
  };
}

/** Durable Object names: alphanumeric, underscore, hyphen. */
export function sanitizeInstanceName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  return cleaned || "default";
}

export function requireSellerKey(config: SellerConfig): string {
  if (!config.sellerApiKey) {
    throw new Error("seller API key missing — provision this agent Durable Object (or set deprecated UNDERWRITE_SELLER_API_KEY)");
  }
  return config.sellerApiKey;
}

export function requireNeuralakeKey(config: SellerConfig): string {
  if (!config.neuralakeApiKey) {
    throw new Error("NeuraLake BYOK missing — paste a key on the agent in Underwrite (or set deprecated NEURALAKE_API_KEY)");
  }
  return config.neuralakeApiKey;
}
