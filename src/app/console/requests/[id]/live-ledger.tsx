"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LedgerEvent, LedgerMetrics } from "@/lib/contracts";
import { summarizeEvent } from "@/lib/ledger/summarize";
import { Badge, TERMINAL_STATUSES } from "../../ui";

type Feed = { status: string; metrics: LedgerMetrics; events: LedgerEvent[] };

const TYPE_TONE: Record<string, string> = {
  escrow_released: "text-acid",
  stake_refunded: "text-acid",
  escrow_withheld: "text-orange",
  stake_forfeited: "text-orange",
  escalated: "text-orange",
  attribution_emitted: "text-orange",
  plan_rejected: "text-orange",
  check_run: "",
  judge_verdict: "",
  wallet_updated: "text-[#87948f]",
  axes_updated: "text-[#87948f]",
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
    <section className="terminal">
      <header className="terminal-head">
        <div className="flex flex-wrap items-center gap-3">
          <span>LIVE PROTOCOL LEDGER</span>
          <Badge value={feed.status} />
          {live ? <span className="text-acid">● live</span> : null}
          <span className="text-[#87948f]">{feed.events.length} events</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span>
            human_interventions{" "}
            <b className={feed.metrics.human_interventions === 0 ? "" : "!text-orange"}>{feed.metrics.human_interventions}</b>
          </span>
          <span className="text-[#87948f]">cost ${feed.metrics.total_cost_usd.toFixed(5)}</span>
          <span className="text-[#87948f]">
            tokens {feed.metrics.tokens_in}/{feed.metrics.tokens_out}
          </span>
          <label className="flex items-center gap-1.5 text-[#87948f] cursor-pointer">
            <input type="checkbox" checked={showMoney} onChange={(e) => setShowMoney(e.target.checked)} />
            wallets
          </label>
        </div>
      </header>
      <ol className="ledger">
        {visible.map((e) => (
          <li key={e.event_id} className="ledger-row">
            <span className="seq">{e.seq}</span>
            <b className={TYPE_TONE[e.type] ?? ""}>{e.type.replaceAll("_", " ")}</b>
            <span className="truncate text-[#87948f]">{e.agent_id ?? ""}</span>
            <span className="truncate" title={summarizeEvent(e)}>
              {summarizeEvent(e)}
            </span>
            <span className="text-right text-[#87948f]">
              {e.cost_usd > 0 ? `$${e.cost_usd.toFixed(5)}` : ""}
              {e.tokens_in + e.tokens_out > 0 ? ` · ${e.tokens_in + e.tokens_out}t` : ""}
            </span>
          </li>
        ))}
        {visible.length === 0 && <li className="await text-[#87948f] font-mono text-[13px] py-9">Awaiting the first ledger event…</li>}
      </ol>
    </section>
  );
}
