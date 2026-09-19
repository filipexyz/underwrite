/**
 * Append-only ledger (CONTRACTS.md §5).
 *
 * Every hop of the marketplace loop writes here. Derived metrics
 * (`total_cost_usd`, `human_interventions`, `handoffs`, …) are computed from
 * the rows — there is no parallel counter anywhere.
 */
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { ledgerEvents, type LedgerEventRow } from "@/lib/db/schema";
import { LedgerEventType, type LedgerEvent, type LedgerMetrics } from "@/lib/contracts";
import { newId, nowMs } from "@/lib/ids";
import { round6 } from "@/lib/observability/pricing";

export type AppendEventInput = {
  type: LedgerEventType;
  agent_id?: string | null;
  model?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  latency_ms?: number;
  parent_event_id?: string | null;
  payload?: Record<string, unknown>;
};

export function rowToEvent(row: LedgerEventRow): LedgerEvent {
  return {
    event_id: row.eventId,
    seq: Number(row.seq),
    ts: Number(row.ts),
    request_id: row.requestId,
    parent_event_id: row.parentEventId,
    type: LedgerEventType.parse(row.type),
    agent_id: row.agentId,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    latency_ms: row.latencyMs,
    payload: row.payload ?? {},
  };
}

export class Ledger {
  private hooks: Array<(event: LedgerEvent) => void> = [];

  constructor(
    private readonly db: Db,
    readonly requestId: string,
  ) {}

  /** Observe every appended event (used by tests and the Mastra step tracer). */
  onAppend(hook: (event: LedgerEvent) => void): void {
    this.hooks.push(hook);
  }

  async append(input: AppendEventInput): Promise<LedgerEvent> {
    const [row] = await this.db
      .insert(ledgerEvents)
      .values({
        eventId: newId("evt"),
        ts: nowMs(),
        requestId: this.requestId,
        parentEventId: input.parent_event_id ?? null,
        type: input.type,
        agentId: input.agent_id ?? null,
        model: input.model ?? null,
        tokensIn: input.tokens_in ?? 0,
        tokensOut: input.tokens_out ?? 0,
        costUsd: round6(input.cost_usd ?? 0),
        latencyMs: Math.round(input.latency_ms ?? 0),
        payload: input.payload ?? {},
      })
      .returning();
    const event = rowToEvent(row);
    for (const hook of this.hooks) hook(event);
    return event;
  }

  async list(): Promise<LedgerEvent[]> {
    return listEvents(this.db, this.requestId);
  }
}

export async function listEvents(db: Db, requestId: string): Promise<LedgerEvent[]> {
  const rows = await db
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.requestId, requestId))
    .orderBy(asc(ledgerEvents.seq));
  return rows.map(rowToEvent);
}

/**
 * `human_interventions` counts events after `request_received` whose actor is
 * a human. The loop never produces one; the counter exists to be provably 0.
 */
export function deriveMetrics(events: LedgerEvent[]): LedgerMetrics {
  let totalCost = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let handoffs = 0;
  let checksPassed = 0;
  let checksTotal = 0;
  let humanInterventions = 0;
  let seenRequest = false;

  for (const e of events) {
    totalCost += e.cost_usd;
    tokensIn += e.tokens_in;
    tokensOut += e.tokens_out;
    if (e.type === "request_received") seenRequest = true;
    if (e.type === "task_delegated") handoffs += 1;
    if (e.type === "check_run") {
      checksTotal += 1;
      if (e.payload.passed === true) checksPassed += 1;
    }
    if (seenRequest && e.type !== "request_received" && e.payload.actor === "human") {
      humanInterventions += 1;
    }
  }

  return {
    total_cost_usd: round6(totalCost),
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_per_check_passed: checksPassed > 0 ? round6(totalCost / checksPassed) : null,
    human_interventions: humanInterventions,
    handoffs,
    checks_passed: checksPassed,
    checks_total: checksTotal,
    events: events.length,
  };
}
