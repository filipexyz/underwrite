import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Timestamp } from "@/components/timestamp";
import { describeDriver } from "@/lib/db/client";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listRequestsForBuyer } from "@/lib/marketplace/requests";

export const dynamic = "force-dynamic";

/** Statuses where nothing more will happen, so the list can show them as settled. */
const TERMINAL = new Set(["completed", "failed", "no_eligible_bid", "no_eligible_plan"]);

/**
 * `/tasks` — every task you created, which did not exist before.
 *
 * Asking for it directly: *"eu preciso ter uma lista das tarefas que eu criei"*. Tasks were only reachable
 * by knowing a request id or by opening an admin console, which is not a product — a buyer with no way to
 * see what they have ordered has no reason to trust any of it.
 *
 * Scoped by buyer wallet, which for voice-created tasks is the signed-in user, so nobody sees anyone else's
 * orders. The list is deliberately plain: what was asked for, what state it is in, what it cost so far.
 */
export default async function TasksPage() {
  const identity = await requireSignedInPage();
  const { db } = await getDb();
  const rows = await listRequestsForBuyer(db, identity.userId, 50);

  return (
    <AppShell section="tasks" hint={`${rows.length} created · ${describeDriver(undefined)}`}>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="eyebrow !mb-0">YOUR TASKS</p>
          <h1 className="page-title !text-[42px]">
            Everything you <em>posted.</em>
          </h1>
          <p className="font-sans text-sm text-[#53605a] max-w-xl leading-relaxed">
            Each row is a task you created by talking to the agent. Open one to follow its bids, escrow and
            verification as they settle.
          </p>
          <Link href="/start" className="btn-ink w-fit">
            <span>Start a new task</span>
            <strong>→</strong>
          </Link>
        </header>

        {rows.length === 0 ? (
          <p className="font-mono text-xs text-muted leading-relaxed">
            Nothing yet. Talk to the agent on /start and the task it posts appears here.
          </p>
        ) : (
          <ul className="flex flex-col border border-line">
            {rows.map((row) => {
              const settled = TERMINAL.has(row.status);
              return (
                <li key={row.requestId} className="border-b border-line last:border-b-0">
                  <Link
                    href={`/tasks/${row.requestId}`}
                    className="grid grid-cols-[110px_1fr_110px] gap-4 items-baseline px-4 py-3.5 hover:bg-panel"
                  >
                    <span className={`mono text-[10px] uppercase tracking-wider ${settled ? "text-muted" : "text-teal"}`}>
                      {row.status}
                    </span>
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm leading-snug truncate">{row.requirement.split("\n")[0]}</span>
                      <span className="mono text-[10px] text-muted">
                        {row.requestId} · floor {Math.round(row.minConfidence * 100)}% · max $
                        {row.maxCostUsd.toFixed(2)} · {row.maxLatencyS}s
                      </span>
                    </span>
                    <Timestamp value={row.createdAt} className="mono text-[10px] text-muted text-right" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
