/**
 * Execution-first SLA (Luís): if deterministic checks all pass, escrow
 * releases even when hardcoded_v0 confidence is below the floor.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Verification } from "@/lib/contracts";
import { getDb, type Db } from "@/lib/db/client";
import { plans, type EscrowRow } from "@/lib/db/schema";
import { walkBack } from "@/lib/marketplace/attribution";
import { buildContext, type EngineContext } from "@/lib/marketplace/context";
import {
  allDeclaredChecksPassed,
  createAndLockEscrow,
  releaseEscrow,
  slaMet,
} from "@/lib/marketplace/escrow";
import { testTaskForAgent } from "@/lib/marketplace/agent-test";
import { judgesFor, type Registry, type RegistryAgent } from "@/lib/marketplace/registry";
import { createRequest } from "@/lib/marketplace/requests";
import type { HopRecord } from "@/lib/marketplace/types";
import { computeConfidence } from "@/lib/verification/confidence";

const FLOOR = 0.95;

const passedChecks = [
  { check_id: "artifact_exists", name: "exists", passed: true, detail: "ok", weight: 1 },
  { check_id: "artifact_renders", name: "renders", passed: true, detail: "ok", weight: 1 },
  { check_id: "artifact_not_empty", name: "not empty", passed: true, detail: "ok", weight: 1 },
];

const failedChecks = [
  { check_id: "artifact_exists", name: "exists", passed: true, detail: "ok", weight: 1 },
  { check_id: "artifact_renders", name: "renders", passed: false, detail: "broken", weight: 1 },
];

function escrowAt(minConfidence = FLOOR): EscrowRow {
  return { minConfidence } as EscrowRow;
}

function hop(agentId: string, extra: Partial<HopRecord> = {}): HopRecord {
  return {
    hop_index: 0,
    agent_id: agentId,
    role: "executor",
    hirer_id: null,
    plan_id: "plan_sla",
    escrow_id: "esc_sla",
    price_usd: 0.04,
    own_cost_usd: 0.04,
    promised_confidence: 0.96,
    floor: FLOOR,
    own_latency_s: 8,
    est_latency_s: 8,
    deadline_s: 30,
    strategy: "self",
    subtask: "brief",
    specialty: "analista de investimentos",
    selection: null,
    ...extra,
  };
}

function verification(overrides: Partial<Verification> = {}): Verification {
  return {
    verification_id: "ver_sla",
    request_id: "req_sla",
    artifact_ref: "art_sla",
    producer_agent_id: "agt_analyst",
    checks: passedChecks,
    confidence: {
      objective: 1,
      agreement: null,
      track_record: 0.25,
      process: 1,
      self_report: 0.96,
      computed: 0.84,
      method: "hardcoded_v0",
    },
    verdict: "pass",
    judges: [],
    judges_disagree: false,
    ...overrides,
  };
}

describe("slaMet — execution-first", () => {
  it("releases when every applicable check passed even if confidence is below the floor", () => {
    const burned = computeConfidence({
      objective: 1,
      agreement: null,
      track_record: 0.25,
      process: 1,
      self_report: 0.96,
    });
    expect(burned.computed).toBeLessThan(FLOOR);
    expect(burned.computed).toBeGreaterThan(0.7);
    expect(allDeclaredChecksPassed(passedChecks)).toBe(true);

    expect(
      slaMet(escrowAt(), {
        verdict: "pass",
        confidence: burned.computed,
        judges_disagree: false,
        all_checks_passed: true,
      }),
    ).toBe(true);
  });

  it("still withholds when any applicable check failed", () => {
    expect(allDeclaredChecksPassed(failedChecks)).toBe(false);
    expect(
      slaMet(escrowAt(), {
        verdict: "fail",
        confidence: 0.99,
        judges_disagree: false,
        all_checks_passed: false,
      }),
    ).toBe(false);
  });

  it("keeps the confidence floor when checks did not all pass", () => {
    expect(
      slaMet(escrowAt(), {
        verdict: "pass",
        confidence: 0.84,
        judges_disagree: false,
        all_checks_passed: false,
      }),
    ).toBe(false);
    expect(
      slaMet(escrowAt(), {
        verdict: "pass",
        confidence: 0.99,
        judges_disagree: false,
        all_checks_passed: false,
      }),
    ).toBe(true);
  });

  it("still withholds on judge disagreement", () => {
    expect(
      slaMet(escrowAt(), {
        verdict: "pass",
        confidence: 0.99,
        judges_disagree: true,
        all_checks_passed: true,
      }),
    ).toBe(false);
  });
});

describe("walkBack — checks passed is not spec_ambiguous", () => {
  it("does not say verdict inconclusive when every check passed", () => {
    const result = walkBack({
      hops: [hop("agt_analyst")],
      failedHopIndex: 0,
      verification: verification(),
    });
    expect(result.root_cause).not.toBe("spec_ambiguous");
    expect(result.explanation).not.toMatch(/verdict inconclusive/i);
    expect(result.explanation).toMatch(/every declared check passed/i);
  });

  it("names judge disagreement instead of an inconclusive verdict", () => {
    const result = walkBack({
      hops: [hop("agt_analyst")],
      failedHopIndex: 0,
      verification: verification({ judges_disagree: true }),
    });
    expect(result.explanation).toMatch(/judges disagreed/i);
    expect(result.explanation).not.toMatch(/verdict inconclusive/i);
  });
});

describe("judgesFor — custom specialties", () => {
  it("falls back to J1/J2 when the category is not one of the four named rubrics", () => {
    const judge = (id: string, specialties: string[]): RegistryAgent =>
      ({ agentId: id, role: "judge", specialties }) as RegistryAgent;
    const registry = {
      category: "analista de investimentos",
      agents: new Map<string, RegistryAgent>([
        ["j1-judge", judge("j1-judge", ["judge:html_to_pdf", "judge:landing_page"])],
        ["j2-judge", judge("j2-judge", ["judge:html_to_pdf"])],
        ["c2-honest", { agentId: "c2-honest", role: "executor", specialties: ["html_to_pdf"] } as RegistryAgent],
      ]),
      pairwise: new Map(),
    } as Registry;

    expect(judgesFor(registry, "analista de investimentos").map((j) => j.agentId)).toEqual(["j1-judge", "j2-judge"]);
    expect(judgesFor(registry, "html_to_pdf").map((j) => j.agentId)).toEqual(["j1-judge", "j2-judge"]);
    expect(judgesFor(registry, "landing_page").map((j) => j.agentId)).toEqual(["j1-judge"]);
  });
});

describe("test fixture copy", () => {
  it("does not ask a non-html_to_pdf specialty for an A4 PDF", () => {
    const built = testTaskForAgent({
      specialties: ["analista de investimentos"],
      role: "executor",
      name: "Carteira Alpha",
      description: "Gera relatórios de alocação e risco.",
    });
    expect(built.task.requirement).toMatch(/HTML briefing/);
    expect(built.task.requirement).not.toMatch(/A4 PDF/i);
    expect(built.task.files[0]?.content).toMatch(/HTML briefing/);
    expect(built.task.files[0]?.content).not.toMatch(/A4 PDF/i);
  });
});

describe("releaseEscrow — settle path", () => {
  let db: Db;

  beforeAll(async () => {
    process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
    ({ db } = await getDb());
  });

  async function lockTestEscrow(requirement: string): Promise<{ ctx: EngineContext; escrow: EscrowRow }> {
    const row = await createRequest(
      db,
      {
        task: { requirement, files: [] },
        max_cost_usd: 0.05,
        max_latency_s: 30,
        min_confidence: FLOOR,
        failure_policy: "refund",
        selection_timeout_s: 5,
        category: "analista de investimentos",
      },
      { source: "tests/execution-first-sla" },
    );
    const ctx = await buildContext(db, row.requestId);
    const planId = `plan_sla_${row.requestId.slice(-8)}`;
    await db.insert(plans).values({
      planId,
      requestId: row.requestId,
      agentId: "c2-honest",
      deliverable: "html",
      promisedConfidence: 0.96,
      maxCostUsd: 0.04,
      estLatencyS: 8,
      chain: [{ agent_id: "c2-honest", role: "executor", subtask: "brief", cost_usd: 0.04 }],
      rationale: "execution-first SLA fixture",
      planCostUsd: 0,
      stakeUsd: 0,
      strategyConsidered: ["self"],
      strategyChosen: "self",
      status: "validated",
    });
    const escrow = await createAndLockEscrow(ctx, {
      plan_id: planId,
      hop_index: 0,
      payer_agent_id: null,
      payee_agent_id: "c2-honest",
      amount_usd: 0.01,
      stake_usd: 0,
      min_confidence: FLOOR,
    });
    return { ctx, escrow };
  }

  it("RELEASES when checks passed and hardcoded_v0 is below the floor", async () => {
    const { ctx, escrow } = await lockTestEscrow("Brief the buyer on portfolio risk.");
    const burned = computeConfidence({
      objective: 1,
      agreement: null,
      track_record: 0.25,
      process: 1,
      self_report: 0.96,
    });
    expect(burned.computed).toBeLessThan(escrow.minConfidence);

    const released = await releaseEscrow(ctx, escrow, {
      verdict: "pass",
      confidence: burned.computed,
      judges_disagree: false,
      all_checks_passed: true,
    });
    expect(released.status).toBe("RELEASED");
  });

  it("refuses RELEASE when an applicable check failed", async () => {
    const { ctx, escrow } = await lockTestEscrow("Brief the buyer on a failed check.");
    await expect(
      releaseEscrow(ctx, escrow, {
        verdict: "fail",
        confidence: 0.99,
        judges_disagree: false,
        all_checks_passed: false,
      }),
    ).rejects.toThrow(/refusing to release/);
  });
});
