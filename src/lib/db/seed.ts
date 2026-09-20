/**
 * Seed catalog — the six agents of the demo scene (ARCHITECTURE.md §9).
 *
 * | Agent | Role         | Profile                | Purpose in the scene                          |
 * | A     | delegator    | cheap, aggressive      | wins the auction, promises 0.96, outsources   |
 * | B     | intermediary | mediocre               | hires the cheapest renderer without history   |
 * | C1    | executor     | liar, too cheap        | promises 0.98, delivers a layout overflow     |
 * | C2    | executor     | mid, honest            | passes the checks                             |
 * | J1/J2 | judge        | other model families   | verdict + agreement                           |
 *
 * Everything the engine needs to reproduce the scene is data in this file.
 * `trust_pairwise` starts empty on purpose (D-022): B learns about C1 live.
 */
import { count } from "drizzle-orm";
import type { AxisVector, RiskTolerance } from "@/lib/contracts";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import type { AgentPolicy } from "@/lib/marketplace/types";
import type { Db } from "./client";
import { agents, trustAxes, trustPairwise, wallets } from "./schema";

export const TASK_CATEGORY = "html_to_pdf";
export const RENDER_SPECIALTY = "pdf_render";
export const JUDGE_CATEGORIES = ["html_to_pdf", "landing_page", "dashboard", "research_report"] as const;

export type SeedAgent = {
  agent_id: string;
  name: string;
  role: "delegator" | "intermediary" | "executor" | "judge";
  specialties: string[];
  model_family: string;
  model: string;
  baseline_confidence: number;
  cost_ceiling_usd: number;
  latency_class: "fast" | "mid" | "slow";
  risk_tolerance: RiskTolerance;
  capital_usd: number;
  axes: AxisVector;
  policy: AgentPolicy;
};

const noSelection = {
  policy: "cheapest" as const,
  check_history: false,
  floor_mode: "pass_through" as const,
};

export const SEED_AGENTS: SeedAgent[] = [
  {
    agent_id: "a-delegator",
    name: "A · Delegator",
    role: "delegator",
    specialties: [TASK_CATEGORY],
    model_family: "family-alpha",
    model: "auto",
    baseline_confidence: 0.92,
    cost_ceiling_usd: 0.03,
    latency_class: "fast",
    risk_tolerance: "high",
    capital_usd: 1.0,
    axes: {
      execution: null,
      selection: 0.85,
      underwriting: 0.9,
      latency: 0.9,
      cost_honesty: 0.9,
      judgment: null,
    },
    policy: {
      prime: {
        strategy: "outsource",
        promised_confidence: 0.96,
        own_latency_s: 3,
        own_cost_usd: 0.008,
        subcontract_specialty: TASK_CATEGORY,
        subtask: "underwrite the SLA, split the job and manage the chain",
      },
      sub: null,
      selection: { policy: "cheapest_trusted", check_history: true, floor_mode: "pass_through" },
      execution: null,
      judge: null,
      planning_tokens: { in: 1800, out: 420 },
    },
  },
  {
    agent_id: "b-mid",
    name: "B · Intermediary",
    role: "intermediary",
    specialties: [TASK_CATEGORY, "html_normalize"],
    model_family: "family-alpha",
    model: "auto",
    baseline_confidence: 0.88,
    cost_ceiling_usd: 0.035,
    latency_class: "mid",
    risk_tolerance: "low",
    capital_usd: 0.5,
    axes: {
      execution: 0.75,
      selection: 0.7,
      underwriting: 0.85,
      latency: 0.85,
      cost_honesty: 0.8,
      judgment: null,
    },
    policy: {
      // Risk-averse with its own money: as prime it only bids work it controls.
      prime: {
        strategy: "self",
        promised_confidence: 0.95,
        own_latency_s: 4,
        own_cost_usd: 0.03,
        subtask: "normalize and render the document end to end",
      },
      // Careless with other people's SLA: under subcontract it hires the cheapest renderer.
      sub: {
        [TASK_CATEGORY]: {
          strategy: "decompose",
          promised_confidence: 0.96,
          own_latency_s: 4,
          own_cost_usd: 0.006,
          subcontract_specialty: RENDER_SPECIALTY,
          subtask: "normalize the HTML (fonts, page size, margins), then subcontract the render",
        },
      },
      selection: { policy: "cheapest", check_history: false, floor_mode: "fixed", fixed_floor: 0.9 },
      execution: {
        quality: "clean",
        latency_s: 18,
        latency_jitter: 0,
        self_report: 0.95,
        tokens: { in: 6000, out: 3200 },
      },
      judge: null,
      planning_tokens: { in: 1500, out: 300 },
    },
  },
  {
    agent_id: "c1-cheap",
    name: "C1 · Cheap renderer",
    role: "executor",
    specialties: [RENDER_SPECIALTY, "text_extraction"],
    model_family: "family-gamma",
    model: "gamma-lite-1b",
    baseline_confidence: 0.7,
    cost_ceiling_usd: 0.01,
    latency_class: "fast",
    risk_tolerance: "high",
    capital_usd: 0.05,
    axes: {
      execution: 0.66,
      selection: null,
      underwriting: 0.4,
      latency: 0.9,
      cost_honesty: 0.8,
      judgment: null,
    },
    policy: {
      prime: null,
      sub: {
        [RENDER_SPECIALTY]: {
          strategy: "self",
          promised_confidence: 0.98,
          own_latency_s: 0,
          own_cost_usd: 0.006,
          subtask: "render the normalized HTML to PDF",
        },
      },
      selection: noSelection,
      execution: {
        quality: "layout_overflow",
        latency_s: 6,
        latency_jitter: 0.089,
        self_report: 0.98,
        tokens: { in: 4000, out: 2500 },
      },
      judge: null,
      planning_tokens: { in: 600, out: 120 },
    },
  },
  {
    agent_id: "c2-honest",
    name: "C2 · Honest renderer",
    role: "executor",
    specialties: [TASK_CATEGORY, RENDER_SPECIALTY],
    model_family: "family-alpha",
    model: "alpha-render-7b",
    baseline_confidence: 0.96,
    cost_ceiling_usd: 0.045,
    latency_class: "mid",
    risk_tolerance: "mid",
    capital_usd: 0.8,
    axes: {
      execution: 0.8,
      selection: null,
      underwriting: 0.95,
      latency: 0.85,
      cost_honesty: 0.9,
      judgment: null,
    },
    policy: {
      prime: {
        strategy: "self",
        promised_confidence: 0.96,
        own_latency_s: 4,
        own_cost_usd: 0.038,
        subtask: "normalize and render the document end to end",
      },
      sub: {
        [TASK_CATEGORY]: {
          strategy: "self",
          promised_confidence: 0.96,
          own_latency_s: 4,
          own_cost_usd: 0.016,
          subtask: "normalize and render the document end to end",
        },
        [RENDER_SPECIALTY]: {
          strategy: "self",
          promised_confidence: 0.96,
          own_latency_s: 0,
          own_cost_usd: 0.012,
          subtask: "render the normalized HTML to PDF",
        },
      },
      selection: noSelection,
      execution: {
        quality: "clean",
        latency_s: 8,
        latency_jitter: 0,
        self_report: 0.96,
        tokens: { in: 4500, out: 2800 },
      },
      judge: null,
      planning_tokens: { in: 1200, out: 250 },
    },
  },
  {
    agent_id: "j1-judge",
    name: "J1 · Judge",
    role: "judge",
    specialties: JUDGE_CATEGORIES.map((c) => `judge:${c}`),
    model_family: "family-beta",
    model: "beta-judge-mini",
    baseline_confidence: 0.9,
    cost_ceiling_usd: 0.005,
    latency_class: "fast",
    risk_tolerance: "low",
    capital_usd: 0.5,
    axes: {
      execution: null,
      selection: null,
      underwriting: null,
      latency: 0.95,
      cost_honesty: 0.95,
      judgment: 0.9,
    },
    policy: {
      prime: null,
      sub: null,
      selection: noSelection,
      execution: null,
      judge: { tokens: { in: 3000, out: 200 } },
      planning_tokens: { in: 0, out: 0 },
    },
  },
  {
    agent_id: "j2-judge",
    name: "J2 · Judge",
    role: "judge",
    specialties: JUDGE_CATEGORIES.map((c) => `judge:${c}`),
    model_family: "family-delta",
    model: "delta-judge-mini",
    baseline_confidence: 0.9,
    cost_ceiling_usd: 0.005,
    latency_class: "fast",
    risk_tolerance: "low",
    capital_usd: 0.5,
    axes: {
      execution: null,
      selection: null,
      underwriting: null,
      latency: 0.95,
      cost_honesty: 0.95,
      judgment: 0.88,
    },
    policy: {
      prime: null,
      sub: null,
      selection: noSelection,
      execution: null,
      judge: { tokens: { in: 3000, out: 200 } },
      planning_tokens: { in: 0, out: 0 },
    },
  },
];

export const SEED_SYSTEM_WALLETS: Array<{ owner_id: string; capital_usd: number }> = [
  { owner_id: SYSTEM_WALLETS.buyer, capital_usd: 10 },
  { owner_id: SYSTEM_WALLETS.marketplace, capital_usd: 0 },
  { owner_id: SYSTEM_WALLETS.provider, capital_usd: 0 },
  { owner_id: SYSTEM_WALLETS.escrow, capital_usd: 0 },
];

/**
 * Resets the registry to its initial state: manifests, axes, wallets, and an
 * empty pairwise-trust graph. Requests and the ledger are never touched.
 */
export async function seed(db: Db): Promise<{ agents: number }> {
  for (const a of SEED_AGENTS) {
    await db
      .insert(agents)
      .values({
        agentId: a.agent_id,
        name: a.name,
        role: a.role,
        specialties: a.specialties,
        modelFamily: a.model_family,
        model: a.model,
        baselineConfidence: a.baseline_confidence,
        costCeilingUsd: a.cost_ceiling_usd,
        latencyClass: a.latency_class,
        riskTolerance: a.risk_tolerance,
        policy: a.policy,
        status: "seed",
        ownerUserId: null,
      })
      .onConflictDoUpdate({
        target: agents.agentId,
        set: {
          name: a.name,
          role: a.role,
          specialties: a.specialties,
          modelFamily: a.model_family,
          model: a.model,
          baselineConfidence: a.baseline_confidence,
          costCeilingUsd: a.cost_ceiling_usd,
          latencyClass: a.latency_class,
          riskTolerance: a.risk_tolerance,
          policy: a.policy,
          status: "seed",
          updatedAt: new Date(),
        },
      });

    await db
      .insert(trustAxes)
      .values({
        agentId: a.agent_id,
        category: TASK_CATEGORY,
        execution: a.axes.execution,
        selection: a.axes.selection,
        underwriting: a.axes.underwriting,
        latency: a.axes.latency,
        costHonesty: a.axes.cost_honesty,
        judgment: a.axes.judgment,
        samples: 0,
      })
      .onConflictDoUpdate({
        target: [trustAxes.agentId, trustAxes.category],
        set: {
          execution: a.axes.execution,
          selection: a.axes.selection,
          underwriting: a.axes.underwriting,
          latency: a.axes.latency,
          costHonesty: a.axes.cost_honesty,
          judgment: a.axes.judgment,
          samples: 0,
          updatedAt: new Date(),
        },
      });

    await db
      .insert(wallets)
      .values({ ownerId: a.agent_id, capitalUsd: a.capital_usd, riskTolerance: a.risk_tolerance })
      .onConflictDoUpdate({
        target: wallets.ownerId,
        set: { capitalUsd: a.capital_usd, riskTolerance: a.risk_tolerance, updatedAt: new Date() },
      });
  }

  for (const w of SEED_SYSTEM_WALLETS) {
    await db
      .insert(wallets)
      .values({ ownerId: w.owner_id, capitalUsd: w.capital_usd, riskTolerance: "mid" })
      .onConflictDoUpdate({
        target: wallets.ownerId,
        set: { capitalUsd: w.capital_usd, updatedAt: new Date() },
      });
  }

  await db.delete(trustPairwise);

  return { agents: SEED_AGENTS.length };
}

export async function seedIfEmpty(db: Db): Promise<boolean> {
  const [{ n }] = await db.select({ n: count() }).from(agents);
  if (Number(n) > 0) return false;
  await seed(db);
  return true;
}
