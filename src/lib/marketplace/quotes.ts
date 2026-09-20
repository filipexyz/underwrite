/**
 * Quotes: how an agent prices a hop and declares its chain (D-020, D-030).
 *
 * A quote is a tree: the agent's own share + (optionally) the quote of the
 * subcontractor it selected. Flattened, it is the `chain` published in the bid
 * and the plan — who executes and how much, never how.
 */
import type { AgentRole, ChainHop, Strategy } from "@/lib/contracts";
import { RULES } from "./context";
import { discover, pairKey, type Registry, type RegistryAgent } from "./registry";
import type { QuotePolicy, SelectionPolicy } from "./types";

export type CandidateSnapshot = {
  agent_id: string;
  price_usd: number | null;
  promised_confidence: number | null;
  latency_s: number | null;
  trust_global: number;
  execution: number | null;
  underwriting: number | null;
  pairwise: number | null;
  eligible: boolean;
  reason: string | null;
};

export type Selection = {
  specialty: string;
  policy: SelectionPolicy;
  history_checked: boolean;
  floor: number;
  candidates: CandidateSnapshot[];
  chosen: string | null;
  /** Chosen price vs. the median of the other eligible quotes. −0.4 = 40% below market. */
  price_vs_market: number | null;
  rationale: string;
};

export type Quote = {
  agent_id: string;
  role: AgentRole;
  strategy: Strategy;
  strategy_considered: Strategy[];
  subtask: string;
  promised_confidence: number;
  /** Share retained by this hop. */
  own_cost_usd: number;
  /** What this hop charges its parent: own share + everything below. */
  price_usd: number;
  own_latency_s: number;
  /** End-to-end latency of this hop including its subcontractors. */
  latency_s: number;
  /** SLA this hop owes its parent. */
  floor_required: number;
  sub: Quote | null;
  selection: Selection | null;
};

export type QuoteContext = {
  registry: Registry;
  /** Agents above this hop (cycle guard) — includes the buyer-facing agent. */
  ancestors: string[];
  /** Agents that already failed on this request; never re-hired. */
  exclude: Set<string>;
  depth: number;
  /**
   * What this hop's hirer can pay — the buyer's ceiling for the prime, the parent's charge below it.
   * Optional: with no budget there is nothing to take a share of, and the absolute price applies.
   */
  budget_usd?: number;
};

const ALL_STRATEGIES: Strategy[] = ["self", "decompose", "outsource"];

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Buyer price = Σ shares + marketplace commission (D-028). */
export function priceToBuyer(sharesTotal: number): number {
  return round6(sharesTotal * (1 + RULES.COMMISSION_RATE));
}

export function commissionOf(buyerPrice: number): number {
  return round6(buyerPrice - buyerPrice / (1 + RULES.COMMISSION_RATE));
}

export function stakeFor(price: number): number {
  return round6(price * RULES.STAKE_RATE);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds the quote an agent submits for a hop. Returns `null` when the agent
 * cannot serve the hop under the given floor/ancestry (no eligible sub, depth).
 */
export function buildQuote(
  agent: RegistryAgent,
  policy: QuotePolicy,
  floorRequired: number,
  ctx: QuoteContext,
): Quote | null {
  const base = {
    agent_id: agent.agentId,
    role: agent.role as AgentRole,
    strategy: policy.strategy,
    strategy_considered: ALL_STRATEGIES,
    subtask: policy.subtask,
    promised_confidence: policy.promised_confidence,
    own_cost_usd: policy.own_cost_usd,
    own_latency_s: policy.own_latency_s,
    floor_required: floorRequired,
  };

  // A share prices against the hirer's ceiling; absent one, the old absolute maths stands unchanged.
  const priced =
    policy.price_share === undefined || ctx.budget_usd === undefined
      ? null
      : round6(Math.max(0, ctx.budget_usd) * policy.price_share);

  if (policy.strategy === "self") {
    const execLatency = agent.policy.execution?.latency_s ?? 0;
    return {
      ...base,
      price_usd: priced === null ? round6(policy.own_cost_usd) : Math.max(priced, round6(policy.own_cost_usd)),
      latency_s: policy.own_latency_s + execLatency,
      sub: null,
      selection: null,
    };
  }

  if (!policy.subcontract_specialty) return null;
  if (ctx.depth + 1 > RULES.MAX_DEPTH) return null;

  // The subcontractor's ceiling is what this hop can pass down: its charge minus the share it retains.
  // Same arithmetic the engine uses to build the child request (price_usd - own_cost_usd), so the two agree.
  const passDown = Math.max(0, (priced ?? ctx.budget_usd ?? 0) - policy.own_cost_usd);
  const selection = selectSubcontractor(agent, policy.subcontract_specialty, floorRequired, {
    ...ctx,
    budget_usd: passDown,
  });
  if (!selection.chosen) return null;
  const sub = selection.quote as Quote;

  return {
    ...base,
    // Never below cost + subcontract: a price that does not cover the chain would hand the child a negative
    // budget (engine.ts:429), which is how a share-priced hop used to kill the request outright.
    price_usd:
      priced === null ? round6(policy.own_cost_usd + sub.price_usd) : Math.max(priced, round6(policy.own_cost_usd + sub.price_usd)),
    latency_s: policy.own_latency_s + sub.latency_s,
    sub,
    selection: selection.selection,
  };
}

function subFloor(agent: RegistryAgent, floorRequired: number): number {
  const sel = agent.policy.selection;
  return sel.floor_mode === "fixed" ? (sel.fixed_floor ?? floorRequired) : floorRequired;
}

/**
 * Discover → Evaluate → Hire, as the hiring agent's policy dictates. The
 * whole candidate set and the reason for the choice are returned so the ledger
 * can reproduce the decision later (the attribution engine reads exactly this).
 */
export function selectSubcontractor(
  hirer: RegistryAgent,
  specialty: string,
  floorRequired: number,
  ctx: QuoteContext,
): { selection: Selection; chosen: string | null; quote: Quote | null } {
  const floor = subFloor(hirer, floorRequired);
  const selPolicy = hirer.policy.selection;
  const excluded = new Set<string>([...ctx.ancestors, hirer.agentId, ...ctx.exclude]);
  const candidates = discover(ctx.registry, { specialty, exclude: excluded });

  const evaluated: Array<{ snapshot: CandidateSnapshot; quote: Quote | null }> = candidates.map((c) => {
    const subPolicy = c.policy.sub?.[specialty] ?? null;
    const pairwise = ctx.registry.pairwise.get(pairKey(hirer.agentId, c.agentId)) ?? null;
    const snapshot: CandidateSnapshot = {
      agent_id: c.agentId,
      price_usd: null,
      promised_confidence: null,
      latency_s: null,
      trust_global: c.trust_global,
      execution: c.axes.execution,
      underwriting: c.axes.underwriting,
      pairwise,
      eligible: false,
      reason: null,
    };
    if (!subPolicy) return { snapshot: { ...snapshot, reason: "does not take this subcontract" }, quote: null };

    const quote = buildQuote(c, subPolicy, floor, {
      ...ctx,
      ancestors: [...ctx.ancestors, hirer.agentId],
      depth: ctx.depth + 1,
        });
    if (!quote) return { snapshot: { ...snapshot, reason: "no feasible chain" }, quote: null };

    snapshot.price_usd = quote.price_usd;
    snapshot.promised_confidence = quote.promised_confidence;
    snapshot.latency_s = quote.latency_s;

    if (quote.promised_confidence < floor) {
      return { snapshot: { ...snapshot, reason: `promises ${quote.promised_confidence} < floor ${floor}` }, quote };
    }
    if (pairwise !== null && pairwise < RULES.PAIRWISE_MIN) {
      return { snapshot: { ...snapshot, reason: `pairwise trust ${pairwise} < ${RULES.PAIRWISE_MIN}` }, quote };
    }
    if (selPolicy.policy === "cheapest_trusted" && c.trust_global < RULES.TRUSTED_MIN) {
      return { snapshot: { ...snapshot, reason: `trust_global ${c.trust_global} < ${RULES.TRUSTED_MIN}` }, quote };
    }
    return { snapshot: { ...snapshot, eligible: true }, quote };
  });

  const eligible = evaluated
    .filter((e) => e.snapshot.eligible && e.quote)
    .sort((a, b) => {
      const qa = a.quote as Quote;
      const qb = b.quote as Quote;
      return (
        qa.price_usd - qb.price_usd ||
        qb.promised_confidence - qa.promised_confidence ||
        b.snapshot.trust_global - a.snapshot.trust_global
      );
    });

  const winner = eligible[0] ?? null;
  const others = eligible.slice(1).map((e) => (e.quote as Quote).price_usd);
  const market = median(others);
  const priceVsMarket =
    winner && market && market > 0 ? round6(((winner.quote as Quote).price_usd - market) / market) : null;

  const rationale = winner
    ? `${selPolicy.policy === "cheapest_trusted" ? "Cheapest trusted" : "Cheapest"} ${specialty} quote: ${winner.snapshot.agent_id} at $${(winner.quote as Quote).price_usd.toFixed(4)} promising ${(winner.quote as Quote).promised_confidence.toFixed(2)} against a floor of ${floor.toFixed(2)}` +
      (selPolicy.check_history
        ? ` (history checked: execution ${fmt(winner.snapshot.execution)}, underwriting ${fmt(winner.snapshot.underwriting)})`
        : " (history not consulted)") +
      (priceVsMarket !== null ? `; ${Math.round(priceVsMarket * 100)}% vs. the other quotes.` : ".")
    : `No eligible ${specialty} candidate for floor ${floor.toFixed(2)}.`;

  return {
    selection: {
      specialty,
      policy: selPolicy.policy,
      history_checked: selPolicy.check_history,
      floor,
      candidates: evaluated.map((e) => e.snapshot),
      chosen: winner?.snapshot.agent_id ?? null,
      price_vs_market: priceVsMarket,
      rationale,
    },
    chosen: winner?.snapshot.agent_id ?? null,
    quote: winner?.quote ?? null,
  };
}

function fmt(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(2);
}

export function flattenChain(quote: Quote): ChainHop[] {
  const hops: ChainHop[] = [];
  let cursor: Quote | null = quote;
  while (cursor) {
    hops.push({
      agent_id: cursor.agent_id,
      role: cursor.role,
      subtask: cursor.subtask,
      cost_usd: cursor.own_cost_usd,
    });
    cursor = cursor.sub;
  }
  return hops;
}

export function quoteAtDepth(quote: Quote, depth: number): Quote | null {
  let cursor: Quote | null = quote;
  for (let i = 0; i < depth && cursor; i += 1) cursor = cursor.sub;
  return cursor;
}

export function chainLabel(quote: Quote): string {
  return flattenChain(quote)
    .map((h) => h.agent_id)
    .join(" → ");
}
