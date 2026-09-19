"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LedgerEvent, LedgerMetrics } from "@/lib/contracts";
import { summarizeEvent } from "@/lib/ledger/summarize";
import { Badge, TERMINAL_STATUSES } from "../../ui";

type Feed = { status: string; metrics: LedgerMetrics; events: LedgerEvent[] };

const TYPE_TONE: Record<string, string> = {
  escrow_released: "text-accent",
  stake_refunded: "text-accent",
  escrow_withheld: "text-danger",
  stake_forfeited: "text-danger",
  escalated: "text-danger",
  attribution_emitted: "text-danger",
  plan_rejected: "text-danger",
  check_run: "",
  judge_verdict: "",
  wallet_updated: "text-muted",
  axes_updated: "text-muted",
};

export function LiveLedger({
  requestId,
  initialStatus,
  initialEvents,
  initialMetrics,
  pollMs = 1500,
}: {
  requestId: string;
  initialStatus: string;
  initialEvents: LedgerEvent[];
  initialMetrics: LedgerMetrics;
  pollMs?: number;
}) {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>({ status: initialStatus, metrics: initialMetrics, events: initialEvents });
  const [showMoney, setShowMoney] = useState(false);
  const lastSeq = useRef(initialEvents.at(-1)?.seq ?? 0);
  const statusRef = useRef(initialStatus);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(statusRef.current)) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/console/requests/${requestId}/events?after=${lastSeq.current}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Feed;
        if (stopped) return;
        if (data.events.length > 0) lastSeq.current = data.events.at(-1)?.seq ?? lastSeq.current;
        setFeed((prev) => ({ status: data.status, metrics: data.metrics, events: data.events.length ? [...prev.events, ...data.events] : prev.events }));
        if (data.status !== statusRef.current) {
          statusRef.current = data.status;
          router.refresh();
        }
      } catch {
        // transient network error — next tick retries
      }
    };
    const id = setInterval(tick, pollMs);
    void tick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [requestId, pollMs, router]);

  const visible = useMemo(() => (showMoney ? feed.events : feed.events.filter((e) => e.type !== "wallet_updated")), [feed.events, showMoney]);
  const live = !TERMINAL_STATUSES.has(feed.status);

  return (
    <section className="rounded-lg border border-border bg-panel">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-wide">Ledger</h2>
          <Badge value={feed.status} />
          {live && <span className="mono text-xs text-warn animate-pulse">● live</span>}
          <span className="mono text-xs text-muted">{feed.events.length} events</span>
        </div>
        <div className="flex items-center gap-4 text-xs mono">
          <span>
            human_interventions: <span className={feed.metrics.human_interventions === 0 ? "text-accent" : "text-danger"}>{feed.metrics.human_interventions}</span>
          </span>
          <span className="text-muted">cost ${feed.metrics.total_cost_usd.toFixed(5)}</span>
          <span className="text-muted">
            tokens {feed.metrics.tokens_in}/{feed.metrics.tokens_out}
          </span>
          <label className="flex items-center gap-1.5 text-muted cursor-pointer">
            <input type="checkbox" checked={showMoney} onChange={(e) => setShowMoney(e.target.checked)} />
            wallets
          </label>
        </div>
      </header>
      <ol className="max-h-[70vh] overflow-y-auto divide-y divide-border/60">
        {visible.map((e) => (
          <li key={e.event_id} className="grid grid-cols-[3rem_12rem_9rem_1fr_7rem] gap-3 px-4 py-1.5 text-xs items-baseline">
            <span className="mono text-muted">{e.seq}</span>
            <span className={`mono ${TYPE_TONE[e.type] ?? ""}`}>{e.type}</span>
            <span className="mono truncate text-muted">{e.agent_id ?? ""}</span>
            <span className="truncate" title={summarizeEvent(e)}>
              {summarizeEvent(e)}
            </span>
            <span className="mono text-right text-muted">
              {e.cost_usd > 0 ? `$${e.cost_usd.toFixed(5)}` : ""}
              {e.tokens_in + e.tokens_out > 0 ? ` · ${e.tokens_in + e.tokens_out}t` : ""}
            </span>
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-3 text-sm text-muted">Waiting for the first event…</li>}
      </ol>
    </section>
  );
}
