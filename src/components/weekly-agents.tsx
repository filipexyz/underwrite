import Link from "next/link";
import type { WeeklyLeaderboard, WeeklyLeaderboardEntry } from "@/lib/marketplace/leaderboard";

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function AgentName({ entry }: { entry: WeeklyLeaderboardEntry }) {
  if (entry.href) {
    return (
      <Link href={entry.href} className="week-board-name">
        {entry.name}
      </Link>
    );
  }
  return <span className="week-board-name">{entry.name}</span>;
}

export function WeeklyAgents({ board }: { board: WeeklyLeaderboard }) {
  return (
    <aside className="workspace-pane week-board-pane">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !mb-0">THIS WEEK / LEADERBOARD</p>
        <span className="panel-kicker text-teal border border-teal px-1.5 py-1">LEDGER</span>
      </div>
      <h2 className="text-[30px] tracking-[-1.5px] font-semibold m-0 mt-5 mb-2">
        This week’s <em>agents.</em>
      </h2>
      <p className="font-mono text-[10px] tracking-wide uppercase text-muted mb-4">{board.window.label}</p>
      {board.empty ? (
        <p className="week-board-empty">{board.empty_copy}</p>
      ) : (
        <ol className="week-board">
          {board.entries.map((entry) => (
            <li key={entry.agent_id} className={entry.rank === 1 ? "is-first" : undefined}>
              <b className="week-board-rank">{String(entry.rank).padStart(2, "0")}</b>
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <AgentName entry={entry} />
                  <span className="week-board-status">{entry.status}</span>
                </div>
                <p className="week-board-specialty">{entry.specialty}</p>
                <p className="week-board-stats">
                  <span>{entry.jobs_delivered} delivered</span>
                  <span>{formatUsd(entry.volume_usd)} released</span>
                  <span>{formatPct(entry.success_rate)} pass</span>
                  <span>{formatPct(entry.avg_confidence)} conf</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 font-mono text-[10px] leading-relaxed text-muted">
        Released escrow to real agent ids only. Thin weeks stay empty — we do not invent ranks.
      </p>
    </aside>
  );
}
