import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { buildQuote } from "@/lib/marketplace/quotes";
import { getAgent, loadRegistry, type Registry } from "@/lib/marketplace/registry";

let registry: Registry;

beforeAll(async () => {
  const { db } = await getDb();
  registry = await loadRegistry(db, TASK_CATEGORY);
});

/** A's prime quote, priced against a ceiling the way the engine prices it. */
function aPrime(budgetUsd?: number) {
  const agent = getAgent(registry, "a-delegator");
  const policy = agent.policy.prime;
  if (!policy) throw new Error("A has no prime policy");
  const quote = buildQuote(agent, policy, 0.95, {
    registry,
    ancestors: [],
    exclude: new Set<string>(),
    depth: 0,
    ...(budgetUsd === undefined ? {} : { budget_usd: budgetUsd }),
  });
  if (!quote) throw new Error("A could not quote");
  return { quote, policy };
}

/**
 * The market used to bid absolute cents against a five-cent ceiling, which is why every auction read as
 * agents charging pennies. A price is now a share of what the hirer can pay — and where there is no
 * ceiling to take a share of, the old absolute arithmetic has to stand untouched.
 */
describe("a seller prices a share of the hirer's ceiling", () => {
  it("takes the share of the ceiling it was quoted against", () => {
    const { quote, policy } = aPrime(10);
    expect(policy.price_share).toBeDefined();
    expect(quote.price_usd).toBeCloseTo(10 * policy.price_share!, 6);
  });

  it("falls back to absolute costs where there is no ceiling to take a share of", () => {
    expect(aPrime().quote.price_usd).toBeLessThan(1);
    expect(aPrime(10).quote.price_usd).toBeGreaterThan(1);
  });

  it("never prices below its own cost plus what it must pay down the chain", () => {
    // A ceiling far too small for the chain's real costs: the share would be a loss, so the cost floor wins.
    const { quote } = aPrime(0.01);
    expect(quote.sub).not.toBeNull();
    expect(quote.price_usd).toBeGreaterThanOrEqual(quote.own_cost_usd + quote.sub!.price_usd);
  });

  it("passes down what it cannot retain, so a subcontractor prices against its hirer's price", () => {
    const { quote } = aPrime(10);
    expect(quote.sub).not.toBeNull();
    expect(quote.sub!.price_usd).toBeLessThan(quote.price_usd);
    // And the hirer can always cover it out of what it charges: nobody quotes a chain they cannot pay for.
    expect(quote.price_usd - quote.own_cost_usd).toBeGreaterThanOrEqual(quote.sub!.price_usd);
  });
});
