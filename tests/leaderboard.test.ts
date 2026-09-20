import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentOnboardPrompt } from "@/lib/marketplace/agent-onboard";
import {
  EMPTY_LEADERBOARD_COPY,
  LEADERBOARD_TZ,
  aggregateWeeklyLeaderboard,
  displayStatus,
  formatWindowLabel,
  publicAgentHref,
  settlementPayee,
  weekWindow,
  type LeaderboardAgent,
  type LeaderboardSettlement,
} from "@/lib/marketplace/leaderboard";

const NOW = new Date("2026-09-20T18:00:00-03:00");

const AGENTS: LeaderboardAgent[] = [
  {
    agent_id: "c2-honest",
    name: "C2 · Honest renderer",
    role: "executor",
    specialties: ["pdf_render"],
    status: "registered",
    runtime_kind: "hosted",
  },
  {
    agent_id: "a-delegator",
    name: "A · Delegator",
    role: "delegator",
    specialties: ["html_to_pdf"],
    status: "seed",
  },
  {
    agent_id: "c1-cheap",
    name: "C1 · Cheap renderer",
    role: "executor",
    specialties: ["pdf_render"],
    status: "seed",
  },
];

function release(
  agentId: string,
  ts: number,
  amount: number,
  confidence: number,
  extra: Partial<LeaderboardSettlement> = {},
): LeaderboardSettlement {
  return {
    type: "escrow_released",
    ts,
    request_id: extra.request_id ?? `req_${agentId}_${ts}`,
    agent_id: agentId,
    payload: {
      payee: agentId,
      amount_usd: amount,
      delivered_confidence: confidence,
      escrow_id: `esc_${agentId}_${ts}`,
      ...extra.payload,
    },
  };
}

function withhold(agentId: string, ts: number, amount: number, confidence: number): LeaderboardSettlement {
  return {
    type: "escrow_withheld",
    ts,
    request_id: `req_w_${agentId}_${ts}`,
    agent_id: agentId,
    payload: {
      payee: agentId,
      amount_usd: amount,
      delivered_confidence: confidence,
      escrow_id: `esc_w_${agentId}_${ts}`,
    },
  };
}

describe("weekWindow (America/Sao_Paulo)", () => {
  it("opens at local midnight six calendar days before `now`", () => {
    const { startMs, endMs } = weekWindow(NOW, LEADERBOARD_TZ);
    expect(endMs).toBe(NOW.getTime());
    // 14 Sep 2026 00:00 BRT (UTC−3, no DST) = 14 Sep 03:00Z
    expect(startMs).toBe(Date.parse("2026-09-14T03:00:00.000Z"));
    expect(formatWindowLabel(startMs, endMs, LEADERBOARD_TZ)).toMatch(/14 Sep/);
    expect(formatWindowLabel(startMs, endMs, LEADERBOARD_TZ)).toContain(LEADERBOARD_TZ);
  });
});

describe("aggregateWeeklyLeaderboard", () => {
  it("ranks by released volume, then jobs, and keeps real pass / confidence", () => {
    const inWindow = Date.parse("2026-09-18T15:00:00.000Z");
    const board = aggregateWeeklyLeaderboard({
      now: NOW,
      agents: AGENTS,
      events: [
        release("c2-honest", inWindow, 0.04, 0.96),
        release("c2-honest", inWindow + 1_000, 0.05, 0.94),
        withhold("c2-honest", inWindow + 2_000, 0.03, 0.4),
        release("a-delegator", inWindow + 3_000, 0.02, 0.91),
        withhold("c1-cheap", inWindow + 4_000, 0.01, 0.41),
      ],
      axes: [
        { agent_id: "c2-honest", execution: 0.88 },
        { agent_id: "c2-honest", execution: 0.92 },
      ],
    });

    expect(board.empty).toBe(false);
    expect(board.entries.map((row) => row.agent_id)).toEqual(["c2-honest", "a-delegator", "c1-cheap"]);
    expect(board.entries[0]).toMatchObject({
      rank: 1,
      name: "C2 · Honest renderer",
      specialty: "pdf_render",
      status: "hosted",
      jobs_delivered: 2,
      volume_usd: 0.09,
      withheld_count: 1,
      href: null,
    });
    expect(board.entries[0].success_rate).toBeCloseTo(2 / 3, 5);
    expect(board.entries[0].avg_confidence).toBeCloseTo((0.96 + 0.94 + 0.4) / 3, 5);
    expect(board.entries[0].execution).toBeCloseTo(0.9, 5);
    expect(board.entries[1].jobs_delivered).toBe(1);
    expect(board.entries[1].status).toBe("seed");
    expect(board.entries[2]).toMatchObject({
      jobs_delivered: 0,
      volume_usd: 0,
      success_rate: 0,
      withheld_count: 1,
    });
  });

  it("drops system wallets, unknown agent ids, and rows outside the week", () => {
    const inWindow = Date.parse("2026-09-19T12:00:00.000Z");
    const outside = Date.parse("2026-09-01T12:00:00.000Z");
    const board = aggregateWeeklyLeaderboard({
      now: NOW,
      agents: AGENTS,
      events: [
        release("c2-honest", inWindow, 0.04, 0.96),
        release("c2-honest", outside, 9.99, 0.99),
        {
          type: "escrow_released",
          ts: inWindow,
          agent_id: "marketplace",
          payload: { payee: "marketplace", amount_usd: 50, delivered_confidence: 1 },
        },
        {
          type: "escrow_released",
          ts: inWindow,
          agent_id: "ghost",
          payload: { payee: "ghost", amount_usd: 12, delivered_confidence: 1 },
        },
      ],
    });
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0].volume_usd).toBe(0.04);
    expect(board.entries[0].jobs_delivered).toBe(1);
  });

  it("uses payee from the payload when agent_id is missing", () => {
    expect(
      settlementPayee({
        type: "escrow_released",
        ts: 1,
        agent_id: null,
        payload: { payee: "c2-honest", amount_usd: 1 },
      }),
    ).toBe("c2-honest");
  });

  it("prefers hosted/registered over seed when volume ties", () => {
    const ts = Date.parse("2026-09-19T12:00:00.000Z");
    const board = aggregateWeeklyLeaderboard({
      now: NOW,
      agents: AGENTS,
      events: [release("a-delegator", ts, 0.04, 0.9), release("c2-honest", ts + 10, 0.04, 0.9)],
    });
    expect(board.entries.map((row) => row.agent_id)).toEqual(["c2-honest", "a-delegator"]);
    expect(board.entries[0].status).toBe("hosted");
    expect(board.entries[1].status).toBe("seed");
  });

  it("does not invent a week when nothing settled", () => {
    const board = aggregateWeeklyLeaderboard({ now: NOW, agents: AGENTS, events: [] });
    expect(board.empty).toBe(true);
    expect(board.entries).toEqual([]);
    expect(board.empty_copy).toBe(EMPTY_LEADERBOARD_COPY);
  });

  it("counts a completed winning hop only when that request has no release", () => {
    const ts = Date.parse("2026-09-19T12:00:00.000Z");
    const board = aggregateWeeklyLeaderboard({
      now: NOW,
      agents: AGENTS,
      events: [],
      completedWins: [
        { request_id: "req_win", completed_at_ms: ts, winning_agent_id: "c2-honest" },
        { request_id: "req_old", completed_at_ms: Date.parse("2026-08-01T00:00:00.000Z"), winning_agent_id: "c2-honest" },
      ],
      verifications: [{ request_id: "req_win", producer_agent_id: "c2-honest", computed: 0.97 }],
    });
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]).toMatchObject({
      jobs_delivered: 1,
      volume_usd: 0,
      success_rate: null,
      avg_confidence: 0.97,
    });
  });

  it("leaves confidence null when the ledger did not record one", () => {
    const ts = Date.parse("2026-09-19T12:00:00.000Z");
    const board = aggregateWeeklyLeaderboard({
      now: NOW,
      agents: AGENTS,
      events: [
        {
          type: "escrow_released",
          ts,
          request_id: "req_plain",
          agent_id: "a-delegator",
          payload: { payee: "a-delegator", amount_usd: 0.03, escrow_id: "esc_plain" },
        },
      ],
    });
    expect(board.entries[0].avg_confidence).toBeNull();
    expect(board.entries[0].success_rate).toBe(1);
    expect(board.entries[0].volume_usd).toBe(0.03);
  });
});

describe("displayStatus", () => {
  it("promotes seed+hosted and registered+hosted to hosted", () => {
    expect(displayStatus({ ...AGENTS[2], runtime_kind: "hosted" })).toBe("hosted");
    expect(displayStatus(AGENTS[0])).toBe("hosted");
    expect(displayStatus(AGENTS[1])).toBe("seed");
  });
});

describe("public agent detail", () => {
  it("has no public catalog href yet", () => {
    expect(publicAgentHref("c2-honest")).toBeNull();
  });
});

describe("homepage public surfaces", () => {
  it("replaces the deploy ops grid with the weekly board and an auth.md prompt", () => {
    const source = readFileSync("src/app/page.tsx", "utf8");
    expect(source).not.toContain("THIS DEPLOYMENT");
    expect(source).not.toContain("Ops key");
    expect(source).not.toContain("Langfuse");
    expect(source).not.toContain("describeDriver");
    expect(source).not.toContain("observabilityStatus");
    expect(source).toContain("WeeklyAgents");
    expect(source).toContain("AgentOnboard");
  });

  it("gives an external agent the discovery and push-job path", () => {
    const prompt = agentOnboardPrompt("https://underwrite.example");
    expect(prompt).toContain("https://underwrite.example/auth.md");
    expect(prompt).toContain("/.well-known/oauth-protected-resource");
    expect(prompt).toContain("/agent/identity");
    expect(prompt).toContain("seller:register");
    expect(prompt).toContain("POST https://underwrite.example/api/v1/requests");
    expect(prompt).toContain('"execution_mode": "push"');
    expect(prompt).toContain("failure_policy");
    expect(prompt).toContain("/api/v1/agents");
    expect(prompt).not.toMatch(/agora gpt live/i);
  });
});
