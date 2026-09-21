/**
 * Public weekly agent leaderboard.
 *
 * Rankings are derived from real settlement rows (`escrow_released` /
 * `escrow_withheld`) plus the agent registry. Nothing here invents a
 * delivery, a dollar amount, or a confidence score.
 */
import { and, eq, gte, lte, or } from "drizzle-orm";
import { SYSTEM_WALLETS } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import {
  agentRuntimeSecrets,
  agents,
  ledgerEvents,
  requests,
  trustAxes,
  verifications,
  type AgentStatus,
} from "@/lib/db/schema";
import { round6 } from "./quotes";

export const LEADERBOARD_TZ = "America/Sao_Paulo";
export const LEADERBOARD_LIMIT = 8;
export const LEADERBOARD_WINDOW_DAYS = 7;
export const LEADERBOARD_REVALIDATE_S = 60;
export const EMPTY_LEADERBOARD_COPY = "No settled jobs this week yet";
export const UNAVAILABLE_LEADERBOARD_COPY = "Leaderboard unavailable";

const SYSTEM_IDS = new Set<string>(Object.values(SYSTEM_WALLETS));

export type SettlementKind = "escrow_released" | "escrow_withheld";

export type LeaderboardSettlement = {
  type: SettlementKind;
  ts: number;
  request_id?: string | null;
  agent_id?: string | null;
  payload: Record<string, unknown>;
};

export type LeaderboardAgent = {
  agent_id: string;
  name: string;
  role: string;
  specialties: string[];
  status: AgentStatus;
  runtime_kind?: "hosted" | "self_hosted" | null;
};

export type LeaderboardVerification = {
  request_id: string;
  producer_agent_id: string;
  computed: number | null;
};

export type CompletedWin = {
  request_id: string;
  completed_at_ms: number;
  winning_agent_id: string | null;
};

export type LeaderboardAxis = {
  agent_id: string;
  execution: number | null;
};

export type PublicLeaderboardStatus =
  | "hosted"
  | "registered"
  | "self_hosted"
  | "seed"
  | "pending_claim"
  | "disabled";

export type WeeklyLeaderboardEntry = {
  rank: number;
  agent_id: string;
  name: string;
  role: string;
  specialty: string;
  status: PublicLeaderboardStatus;
  href: string | null;
  jobs_delivered: number;
  volume_usd: number;
  withheld_count: number;
  settled_count: number;
  success_rate: number | null;
  avg_confidence: number | null;
  execution: number | null;
};

export type WeeklyLeaderboardWindow = {
  start_ms: number;
  end_ms: number;
  start_iso: string;
  end_iso: string;
  label: string;
};

export type WeeklyLeaderboard = {
  timezone: string;
  window: WeeklyLeaderboardWindow;
  empty: boolean;
  empty_copy: string;
  entries: WeeklyLeaderboardEntry[];
};

export function isSystemActor(id: string | null | undefined): boolean {
  return Boolean(id && SYSTEM_IDS.has(id));
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function settlementPayee(event: LeaderboardSettlement): string | null {
  const payee = event.payload.payee;
  if (typeof payee === "string" && payee.trim()) return payee.trim();
  if (typeof event.agent_id === "string" && event.agent_id.trim()) return event.agent_id.trim();
  return null;
}

/** Prefer registered/hosted labels over a seed badge when both apply. */
export function displayStatus(agent: LeaderboardAgent): PublicLeaderboardStatus {
  if (agent.status === "disabled") return "disabled";
  if (agent.status === "pending_claim") return "pending_claim";
  if (agent.runtime_kind === "hosted" && (agent.status === "registered" || agent.status === "seed")) {
    return "hosted";
  }
  if (agent.status === "registered") {
    return agent.runtime_kind === "self_hosted" ? "self_hosted" : "registered";
  }
  if (agent.status === "seed") return "seed";
  return "seed";
}

function statusRank(status: PublicLeaderboardStatus): number {
  switch (status) {
    case "hosted":
      return 0;
    case "registered":
      return 1;
    case "self_hosted":
      return 2;
    case "seed":
      return 3;
    case "pending_claim":
      return 4;
    case "disabled":
      return 5;
  }
}

export function specialtyOf(agent: Pick<LeaderboardAgent, "specialties" | "role">): string {
  return agent.specialties.find((item) => !item.startsWith("judge:")) ?? agent.specialties[0] ?? agent.role;
}

/** `/agents/[id]` is owner-only; there is no public catalog page yet. */
export function publicAgentHref(_agentId: string): string | null {
  return null;
}

type Ymd = { year: number; month: number; day: number };

export function zonedYmd(date: Date, tz: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function addCalendarDays(ymd: Ymd, days: number): Ymd {
  const utc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(new Date(utcMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}

export function zonedMidnightUtcMs(year: number, month: number, day: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  return guess - tzOffsetMs(guess, tz);
}

/** Last 7 calendar days in `tz`, from local midnight of (today − 6) through `now`. */
export function weekWindow(now: Date = new Date(), tz = LEADERBOARD_TZ): { startMs: number; endMs: number } {
  const endMs = now.getTime();
  const startLocal = addCalendarDays(zonedYmd(now, tz), -(LEADERBOARD_WINDOW_DAYS - 1));
  return { startMs: zonedMidnightUtcMs(startLocal.year, startLocal.month, startLocal.day, tz), endMs };
}

export function formatWindowLabel(startMs: number, endMs: number, tz = LEADERBOARD_TZ): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const start = fmt.format(new Date(startMs));
  const end = fmt.format(new Date(endMs));
  return start === end ? `${end} · ${tz}` : `${start} – ${end} · ${tz}`;
}

export function describeWindow(now: Date = new Date(), tz = LEADERBOARD_TZ): WeeklyLeaderboardWindow {
  const { startMs, endMs } = weekWindow(now, tz);
  return {
    start_ms: startMs,
    end_ms: endMs,
    start_iso: new Date(startMs).toISOString(),
    end_iso: new Date(endMs).toISOString(),
    label: formatWindowLabel(startMs, endMs, tz),
  };
}

export function emptyLeaderboard(
  now: Date = new Date(),
  tz = LEADERBOARD_TZ,
  copy = EMPTY_LEADERBOARD_COPY,
): WeeklyLeaderboard {
  return {
    timezone: tz,
    window: describeWindow(now, tz),
    empty: true,
    empty_copy: copy,
    entries: [],
  };
}

function average(values: number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function escrowKey(event: LeaderboardSettlement, payee: string, index: number): string {
  const id = event.payload.escrow_id;
  if (typeof id === "string" && id) return id;
  if (event.request_id) return `${event.request_id}:${payee}:${event.type}`;
  return `${payee}:${event.ts}:${index}`;
}

type Bucket = {
  releasedEscrows: Set<string>;
  withheldEscrows: Set<string>;
  releasedRequests: Set<string>;
  fallbackWins: Set<string>;
  volume: number;
  confidences: number[];
};

function emptyBucket(): Bucket {
  return {
    releasedEscrows: new Set(),
    withheldEscrows: new Set(),
    releasedRequests: new Set(),
    fallbackWins: new Set(),
    volume: 0,
    confidences: [],
  };
}

export function aggregateWeeklyLeaderboard(input: {
  events: LeaderboardSettlement[];
  agents: LeaderboardAgent[];
  verifications?: LeaderboardVerification[];
  completedWins?: CompletedWin[];
  axes?: LeaderboardAxis[];
  now?: Date;
  timezone?: string;
  limit?: number;
}): WeeklyLeaderboard {
  const now = input.now ?? new Date();
  const tz = input.timezone ?? LEADERBOARD_TZ;
  const limit = input.limit ?? LEADERBOARD_LIMIT;
  const { startMs, endMs } = weekWindow(now, tz);
  const agentById = new Map(input.agents.map((agent) => [agent.agent_id, agent]));

  const axesByAgent = new Map<string, number[]>();
  for (const row of input.axes ?? []) {
    if (row.execution === null) continue;
    const list = axesByAgent.get(row.agent_id) ?? [];
    list.push(row.execution);
    axesByAgent.set(row.agent_id, list);
  }

  const verificationByHop = new Map<string, number[]>();
  for (const row of input.verifications ?? []) {
    if (row.computed === null) continue;
    const key = `${row.request_id}:${row.producer_agent_id}`;
    const list = verificationByHop.get(key) ?? [];
    list.push(row.computed);
    verificationByHop.set(key, list);
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (agentId: string): Bucket => {
    const existing = buckets.get(agentId);
    if (existing) return existing;
    const created = emptyBucket();
    buckets.set(agentId, created);
    return created;
  };

  input.events.forEach((event, index) => {
    if (event.ts < startMs || event.ts > endMs) return;
    if (event.type !== "escrow_released" && event.type !== "escrow_withheld") return;
    const payee = settlementPayee(event);
    if (!payee || isSystemActor(payee) || !agentById.has(payee)) return;

    const bucket = bucketFor(payee);
    const key = escrowKey(event, payee, index);
    const amount = finiteNumber(event.payload.amount_usd) ?? 0;
    const delivered = finiteNumber(event.payload.delivered_confidence);
    const verKey = event.request_id ? `${event.request_id}:${payee}` : null;
    const fromVerification = verKey ? verificationByHop.get(verKey) : undefined;
    const confidence = delivered ?? (fromVerification?.length ? average(fromVerification) : null);

    if (event.type === "escrow_released") {
      if (!bucket.releasedEscrows.has(key)) {
        bucket.releasedEscrows.add(key);
        bucket.volume += amount;
        if (event.request_id) bucket.releasedRequests.add(event.request_id);
      }
    } else if (!bucket.withheldEscrows.has(key)) {
      bucket.withheldEscrows.add(key);
    }
    if (confidence !== null) bucket.confidences.push(confidence);
  });

  for (const win of input.completedWins ?? []) {
    if (win.completed_at_ms < startMs || win.completed_at_ms > endMs) continue;
    const agentId = win.winning_agent_id;
    if (!agentId || isSystemActor(agentId) || !agentById.has(agentId)) continue;
    const bucket = bucketFor(agentId);
    if (bucket.releasedRequests.has(win.request_id)) continue;
    bucket.fallbackWins.add(win.request_id);
    const fromVerification = verificationByHop.get(`${win.request_id}:${agentId}`);
    if (fromVerification?.length && bucket.confidences.length === 0) {
      bucket.confidences.push(average(fromVerification));
    }
  }

  const unranked = [...buckets.entries()]
    .map(([agentId, bucket]) => {
      const agent = agentById.get(agentId);
      if (!agent) return null;
      const releasedCount = bucket.releasedEscrows.size;
      const withheldCount = bucket.withheldEscrows.size;
      const jobsDelivered = releasedCount > 0 ? releasedCount : bucket.fallbackWins.size;
      const settledCount = releasedCount + withheldCount;
      const successRate = settledCount > 0 ? releasedCount / settledCount : null;
      const execSamples = axesByAgent.get(agentId);
      return {
        rank: 0,
        agent_id: agentId,
        name: agent.name,
        role: agent.role,
        specialty: specialtyOf(agent),
        status: displayStatus(agent),
        href: publicAgentHref(agentId),
        jobs_delivered: jobsDelivered,
        volume_usd: round6(bucket.volume),
        withheld_count: withheldCount,
        settled_count: settledCount,
        success_rate: successRate === null ? null : round6(successRate),
        avg_confidence: bucket.confidences.length ? round6(average(bucket.confidences)) : null,
        execution: execSamples?.length ? round6(average(execSamples)) : null,
      } satisfies WeeklyLeaderboardEntry;
    })
    .filter((row): row is WeeklyLeaderboardEntry => row !== null && (row.settled_count > 0 || row.jobs_delivered > 0));

  unranked.sort((a, b) => {
    return (
      b.volume_usd - a.volume_usd ||
      b.jobs_delivered - a.jobs_delivered ||
      (b.success_rate ?? -1) - (a.success_rate ?? -1) ||
      (b.avg_confidence ?? -1) - (a.avg_confidence ?? -1) ||
      statusRank(a.status) - statusRank(b.status) ||
      a.agent_id.localeCompare(b.agent_id)
    );
  });

  const entries = unranked.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    timezone: tz,
    window: describeWindow(now, tz),
    empty: entries.length === 0,
    empty_copy: EMPTY_LEADERBOARD_COPY,
    entries,
  };
}

function winningAgentFromOutcome(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== "object") return null;
  const certificate = (outcome as { certificate?: { chain?: unknown } }).certificate;
  const chain = certificate?.chain;
  return Array.isArray(chain) && typeof chain[0] === "string" ? chain[0] : null;
}

export async function loadWeeklyLeaderboard(db: Db, now: Date = new Date()): Promise<WeeklyLeaderboard> {
  const { startMs, endMs } = weekWindow(now);
  const startAt = new Date(startMs);

  const [eventRows, agentRows, runtimeRows, axesRows, verificationRows, completedRows] = await Promise.all([
    db
      .select({
        type: ledgerEvents.type,
        ts: ledgerEvents.ts,
        agentId: ledgerEvents.agentId,
        requestId: ledgerEvents.requestId,
        payload: ledgerEvents.payload,
      })
      .from(ledgerEvents)
      .where(
        and(
          or(eq(ledgerEvents.type, "escrow_released"), eq(ledgerEvents.type, "escrow_withheld")),
          gte(ledgerEvents.ts, startMs),
          lte(ledgerEvents.ts, endMs),
        ),
      ),
    db
      .select({
        agentId: agents.agentId,
        name: agents.name,
        role: agents.role,
        specialties: agents.specialties,
        status: agents.status,
      })
      .from(agents),
    db
      .select({
        agentId: agentRuntimeSecrets.agentId,
        runtimeKind: agentRuntimeSecrets.runtimeKind,
      })
      .from(agentRuntimeSecrets),
    db.select({ agentId: trustAxes.agentId, execution: trustAxes.execution }).from(trustAxes),
    db
      .select({
        requestId: verifications.requestId,
        producerAgentId: verifications.producerAgentId,
        confidence: verifications.confidence,
        createdAt: verifications.createdAt,
      })
      .from(verifications)
      .where(gte(verifications.createdAt, startAt)),
    db
      .select({
        requestId: requests.requestId,
        completedAt: requests.completedAt,
        outcome: requests.outcome,
      })
      .from(requests)
      .where(and(eq(requests.status, "completed"), gte(requests.completedAt, startAt))),
  ]);

  const runtimeByAgent = new Map(runtimeRows.map((row) => [row.agentId, row.runtimeKind]));

  return aggregateWeeklyLeaderboard({
    now,
    events: eventRows
      .filter((row): row is typeof row & { type: SettlementKind } => row.type === "escrow_released" || row.type === "escrow_withheld")
      .map((row) => ({
        type: row.type,
        ts: row.ts,
        request_id: row.requestId,
        agent_id: row.agentId,
        payload: row.payload ?? {},
      })),
    agents: agentRows.map((row) => ({
      agent_id: row.agentId,
      name: row.name,
      role: row.role,
      specialties: row.specialties,
      status: row.status,
      runtime_kind: runtimeByAgent.get(row.agentId) ?? null,
    })),
    verifications: verificationRows.map((row) => ({
      request_id: row.requestId,
      producer_agent_id: row.producerAgentId,
      computed: finiteNumber(row.confidence?.computed),
    })),
    completedWins: completedRows
      .filter((row) => row.completedAt && row.completedAt.getTime() <= endMs)
      .map((row) => ({
        request_id: row.requestId,
        completed_at_ms: row.completedAt!.getTime(),
        winning_agent_id: winningAgentFromOutcome(row.outcome),
      })),
    axes: axesRows.map((row) => ({ agent_id: row.agentId, execution: row.execution })),
  });
}
