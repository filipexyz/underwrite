import type { ModelPrice } from "@/lib/marketplace/types";

/**
 * List prices per 1M tokens. Fictional but internally consistent: the cheap
 * renderer is ~10x cheaper than the honest one, judges sit in between.
 * `auto` is the routed price class (NeuraLake `model="auto"`).
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  auto: { input_per_1m_usd: 0.3, output_per_1m_usd: 1.2 },
  "gamma-lite-1b": { input_per_1m_usd: 0.05, output_per_1m_usd: 0.1 },
  "alpha-render-7b": { input_per_1m_usd: 0.4, output_per_1m_usd: 1.6 },
  "alpha-general-13b": { input_per_1m_usd: 0.6, output_per_1m_usd: 2.4 },
  "beta-judge-mini": { input_per_1m_usd: 0.25, output_per_1m_usd: 1.0 },
  "delta-judge-mini": { input_per_1m_usd: 0.3, output_per_1m_usd: 1.2 },
};

const FALLBACK_PRICE: ModelPrice = { input_per_1m_usd: 0.5, output_per_1m_usd: 1.5 };

export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

export function costForTokens(model: string, tokensIn: number, tokensOut: number): number {
  const price = priceFor(model);
  const cost = (tokensIn * price.input_per_1m_usd + tokensOut * price.output_per_1m_usd) / 1_000_000;
  return round6(cost);
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
