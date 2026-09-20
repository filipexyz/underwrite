import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Timestamp } from "@/components/timestamp";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { deriveMetrics, listEvents } from "@/lib/ledger/ledger";
import { getRequest } from "@/lib/marketplace/requests";
import { summarizeEvent } from "@/lib/ledger/summarize";
import { TaskAutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

/**
 * The delivered bytes, as the engine stores them. Optional in every field because a task that failed has no
 * artifact at all, and a task still running has no shape yet.
 */
type StoredArtifact = {
  kind?: string;
  producer_agent_id?: string;
  observed_latency_ms?: number;
  declared_latency_ms?: number;
  pdf_base64?: string;
  html?: string;
  markdown?: string;
};

function artifactSize(a: StoredArtifact): number {
  if (typeof a.pdf_base64 === "string") return Math.round((a.pdf_base64.length * 3) / 4);
  if (typeof a.html === "string") return Buffer.byteLength(a.html, "utf-8");
  if (typeof a.markdown === "string") return Buffer.byteLength(a.markdown, "utf-8");
  return 0;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Statuses where nothing more will happen, so live refresh can stop. */
const TERMINAL = new Set(["completed", "failed", "no_eligible_bid", "no_eligible_plan"]);

/**
 * `/tasks/[id]` — follow your own task.
 *
 * Where the voice composer lands once it has posted. It exists because the ops console is admin-only:
 * without this, a person who just talked a task into existence had no way to watch it settle.
 *
 * Ownership is enforced here rather than trusted from the URL: a task is visible to the wallet that
 * paid for it, which for voice-created tasks is the signed-in user. Anything else is a 404, so the
 * response does not reveal that an id exists.
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requireSignedInPage();
  const { id } = await params;
  const { db } = await getDb();

  const request = await getRequest(db, id);
  if (!request || request.buyerWalletId !== identity.userId) notFound();

  const stored = request.state as { artifact?: StoredArtifact } | null;
  const artifact = stored?.artifact;
  const artifactUrl = `/api/v1/requests/${id}/artifact`;
  const events = await listEvents(db, id);
  const metrics = deriveMetrics(events);
  const active = !TERMINAL.has(request.status);
  // Newest first reads better for a running task; three dozen is enough to see the shape.
  const recent = [...events].reverse().slice(0, 40);

  return (
    <AppShell section="task" hint="live settlement">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <p className="eyebrow !mb-0">TASK / {request.category}</p>
            <TaskAutoRefresh active={active} />
          </div>
          <h1 className="page-title !text-[32px]">{request.requirement.split("\n")[0]}</h1>
          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted">
            <span>{id}</span>
            <span>status {request.status}</span>
            <Span label="floor" value={`${Math.round(request.minConfidence * 100)}%`} />
            <Span label="max" value={`$${request.maxCostUsd.toFixed(2)}`} />
            <Span label="deadline" value={`${request.maxLatencyS}s`} />
            <Timestamp value={request.createdAt} />
          </div>
        </header>

        {active ? (
          <p className="border border-line bg-panel px-4 py-3 text-sm text-[#53605a]">
            Agents are bidding and settling. This page updates itself — nothing to do.
          </p>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="spend" value={`$${(metrics.total_cost_usd ?? 0).toFixed(4)}`} />
          <Stat label="handoffs" value={String(metrics.handoffs)} />
          <Stat label="checks" value={`${metrics.checks_passed}/${metrics.checks_total}`} />
          <Stat label="human interventions" value={String(metrics.human_interventions)} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="eyebrow !mb-0">Deliverable</h2>
          {artifact ? (
            <div className="border border-line bg-panel">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="mono text-[11px] text-ink">
                    {artifact.kind ?? "file"} · {humanBytes(artifactSize(artifact))}
                  </span>
                  <span className="text-xs leading-relaxed text-[#53605a]">
                    produced by {artifact.producer_agent_id ?? "the chain"}
                    {typeof artifact.observed_latency_ms === "number"
                      ? ` · executed in ${(artifact.observed_latency_ms / 1000).toFixed(1)}s`
                      : ""}
                  </span>
                </div>
                <a
                  href={artifactUrl}
                  download
                  className="border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wide text-paper uppercase"
                >
                  Download
                </a>
              </div>
              {artifact.kind === "pdf" ? (
                <iframe src={artifactUrl} title="Deliverable" className="h-[520px] w-full bg-white" />
              ) : artifact.kind === "html" ? (
                <iframe src={artifactUrl} title="Deliverable" className="h-[420px] w-full bg-white" />
              ) : null}
            </div>
          ) : (
            <p className="border border-line bg-panel px-4 py-3 text-sm text-[#53605a]">
              {active
                ? "Nothing delivered yet — the chain is still working."
                : "No artifact was delivered for this task."}
            </p>
          )}
        </section>

        <details className="border border-line bg-paper">
          <summary className="cursor-pointer px-4 py-3 eyebrow !mb-0">Agreed brief</summary>
          <pre className="px-4 pb-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {request.requirement}
          </pre>
        </details>

        <section className="flex flex-col gap-3">
          <h2 className="eyebrow !mb-0">Ledger</h2>
          {recent.length === 0 ? (
            <p className="font-mono text-xs text-muted">Nothing yet.</p>
          ) : (
            <ol className="flex flex-col border border-line">
              {recent.map((event) => (
                <li
                  key={event.event_id}
                  className="border-b border-line last:border-b-0 px-4 py-3 grid grid-cols-[64px_1fr] gap-4 items-baseline"
                >
                  <span className="mono text-[10px] text-muted">#{event.seq}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="mono text-[11px] text-ink">{event.type}</span>
                    <span className="text-xs leading-relaxed text-[#53605a]">{summarizeEvent(event)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="flex flex-wrap gap-3">
          <Link href="/start" className="btn-ghost">
            ← New task
          </Link>
          <Link href="/keys" className="btn-ghost">
            Keys and wallet
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Span({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label} <span className="text-ink">{value}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-paper px-4 py-3">
      <p className="eyebrow !mb-1">{label}</p>
      <p className="mono text-lg">{value}</p>
    </div>
  );
}
