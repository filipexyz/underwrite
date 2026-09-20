"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LiveLedger } from "@/app/console/requests/[id]/live-ledger";
import { Badge, Empty, Money, Panel, PhaseRail, Stat, inputClass } from "@/app/console/ui";
import type { LedgerEvent, LedgerMetrics } from "@/lib/contracts";
import {
  TEST_FIXTURE_SUMMARY,
  type AgentTestReadiness,
  type PublicTestRuntime,
  type RecentAgentTest,
} from "@/lib/marketplace/agent-test-types";

type PublicAgent = {
  agent_id: string;
  name: string;
  status: string;
  specialties: string[];
  webhook_url: string | null;
};

type AgentOption = {
  agent_id: string;
  name: string;
  status: string;
  specialties: string[];
};

type JobResult = {
  request_id: string;
  status: string;
  invited_agent_ids: string[];
  requested_invite_agent_ids: string[];
  deliveries: Array<{ agent_id: string; channel: string; webhook_ok: boolean | null }>;
  skipped: Array<{ agent_id: string; reason: string }>;
  plan_deadline_at: string;
  targeted: boolean;
  links: { console: string; events: string };
  error?: string;
};

const EMPTY_METRICS: LedgerMetrics = {
  total_cost_usd: 0,
  tokens_in: 0,
  tokens_out: 0,
  cost_per_check_passed: null,
  human_interventions: 0,
  handoffs: 0,
  checks_passed: 0,
  checks_total: 0,
  events: 0,
};

function phaseSteps(status: string | null) {
  const order = ["received", "planning", "executing", "settled"] as const;
  const current =
    !status || status === "received"
      ? "received"
      : status === "planning"
        ? "planning"
        : status === "executing" || status === "verifying"
          ? "executing"
          : "settled";
  const idx = order.indexOf(current);
  const failed = status === "failed" || status === "no_eligible_plan" || status === "no_eligible_bid";
  const delivered = status === "completed";
  const label = (n: string, title: string, sub: string, i: number) => ({
    n,
    title,
    sub,
    state: (i < idx ? "passed" : i === idx ? "active" : "waiting") as "waiting" | "active" | "passed",
  });
  return [
    label("01", "Received", "buyer request held", 0),
    label("02", "Plans", "webhook / inbox", 1),
    label("03", "Selected", "best-score lock", 2),
    {
      n: "04",
      title: failed ? "Failed" : delivered ? "Delivered" : "Settle",
      sub: failed ? status ?? "failed" : delivered ? "judge vs plan" : "awaiting worker",
      state: idx >= 3 ? ("passed" as const) : current === "settled" ? ("active" as const) : ("waiting" as const),
    },
  ];
}

export function AgentTestArea({
  agent,
  runtime,
  readiness: initialReadiness,
  recent: initialRecent,
  agents,
  walletUsd,
}: {
  agent: PublicAgent;
  runtime: PublicTestRuntime;
  readiness: AgentTestReadiness;
  recent: RecentAgentTest[];
  agents: AgentOption[];
  walletUsd: number;
}) {
  const router = useRouter();
  const [readiness, setReadiness] = useState(initialReadiness);
  const [recent, setRecent] = useState(initialRecent);
  const [job, setJob] = useState<JobResult | null>(null);
  const [error, setError] = useState<{ status: number; message: string; details?: unknown } | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const blockers = useMemo(() => readiness.checks.filter((c) => c.severity === "block" && !c.ok), [readiness.checks]);
  const warnings = useMemo(() => readiness.checks.filter((c) => c.severity === "warn" && !c.ok), [readiness.checks]);
  const canRun = readiness.ready && !pending;

  const liveRequestId = job?.request_id ?? null;
  useEffect(() => {
    if (!liveRequestId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/console/requests/${liveRequestId}/events?after=0`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as { status?: string };
        const nextStatus = body.status;
        if (nextStatus) {
          setJob((prev) => (prev && prev.status !== nextStatus ? { ...prev, status: nextStatus } : prev));
        }
      } catch {
        // next tick
      }
    };
    const id = setInterval(tick, 1500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [liveRequestId]);

  async function refreshDiagnosis() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/account/agents/${agent.agent_id}/test`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { readiness: AgentTestReadiness; recent: RecentAgentTest[] };
      setReadiness(body.readiness);
      setRecent(body.recent);
    } finally {
      setRefreshing(false);
    }
  }

  async function runTest() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/agents/${agent.agent_id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as JobResult & { error?: string; details?: unknown };
      if (!res.ok) {
        setError({ status: res.status, message: body.error ?? `http ${res.status}`, details: body.details });
        return;
      }
      setJob(body);
      await refreshDiagnosis();
      router.refresh();
    } catch (err) {
      setError({ status: 0, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <label className="flex flex-col gap-1 text-sm md:w-80">
          <span className="eyebrow !mb-0">your agent</span>
          <select
            className={inputClass}
            value={agent.agent_id}
            onChange={(event) => router.push(`/agents/${event.target.value}/test`)}
          >
            {agents.map((option) => (
              <option key={option.agent_id} value={option.agent_id}>
                {option.name} · {option.status}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Link href={`/agents/${agent.agent_id}`} className="btn-ghost">
            Agent detail
          </Link>
          <button type="button" className="btn-ghost" onClick={() => void refreshDiagnosis()} disabled={refreshing}>
            {refreshing ? "Checking…" : "Recheck runtime"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Hosted runtime" eyebrow="CLOUDFLARE WORKER" aside={<Badge value={runtime.provisioned ? "provisioned" : "pending"} />}>
          <dl className="grid gap-4 md:grid-cols-2 text-sm">
            <Stat label="webhook" value={<span className="break-all">{runtime.webhook_url ?? "inbox fallback"}</span>} />
            <Stat label="hosted URL" value={<span className="break-all">{runtime.hosted_webhook_url ?? "HOSTED_SELLER_BASE_URL unset"}</span>} />
            <Stat label="Durable Object" value={runtime.provisioned ? "provisioned" : "not yet"} />
            <Stat label="BYOK" value={runtime.byok_configured ? "configured" : "missing"} />
            <Stat label="HMAC" value={runtime.webhook_secret_configured ? "per-agent" : "platform fallback"} />
            <Stat label="your wallet" value={<Money value={walletUsd} digits={2} />} />
          </dl>
          {readiness.last_error ? (
            <p className="mt-4 text-sm text-danger">
              Last error ({readiness.last_error.source}
              {readiness.last_error.at ? ` · ${new Date(readiness.last_error.at).toLocaleString()}` : ""}):{" "}
              {readiness.last_error.message}
            </p>
          ) : (
            <p className="mt-4 text-sm text-[#53605a]">No stored webhook error for this agent.</p>
          )}
        </Panel>
        <Panel title="Worker health" eyebrow="GET /health" aside={<Badge value={readiness.worker.reachable ? "up" : "down"} />}>
          <dl className="grid gap-4 text-sm">
            <Stat label="HOSTED_SELLER_BASE_URL" value={<span className="break-all">{readiness.hosted_seller_base_url ?? "—"}</span>} />
            <Stat label="platform UNDERWRITE_BASE_URL" value={<span className="break-all">{readiness.platform_underwrite_base_url}</span>} />
            <Stat
              label="Worker UNDERWRITE_BASE_URL"
              value={<span className="break-all">{readiness.worker.underwrite_base_url ?? "—"}</span>}
            />
            <Stat
              label="runtime secret on Worker"
              value={
                readiness.worker.hosted_runtime_secret_configured == null
                  ? "unknown"
                  : readiness.worker.hosted_runtime_secret_configured
                    ? "configured"
                    : "missing"
              }
            />
          </dl>
          {readiness.worker.error ? <p className="mt-4 text-sm text-danger">{readiness.worker.error}</p> : null}
        </Panel>
      </div>

      {blockers.length > 0 || warnings.length > 0 ? (
        <Panel title="Readiness" eyebrow="EMPTY STATES" aside={<Badge value={readiness.ready ? "warn" : "block"} />}>
          <ul className="flex flex-col gap-3">
            {[...blockers, ...warnings].map((item) => (
              <li key={item.id} className="text-sm">
                <p className="flex items-center gap-2">
                  <Badge value={item.severity} />
                  <span className="font-medium">{item.title}</span>
                </p>
                <p className={`pt-1 ${item.severity === "block" ? "text-danger" : "text-[#53605a]"}`}>{item.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel title="Readiness" eyebrow="EMPTY STATES" aside={<Badge value="ready" />}>
          <Empty>No blocking env, BYOK, or webhook issues. The Worker can still fail the live job — watch the ledger.</Empty>
        </Panel>
      )}

      <Panel
        title="Run a test job"
        eyebrow="REAL PUSH PATH"
        aside={<Badge value="invite_agent_ids" />}
      >
        <p className="text-sm text-[#53605a] leading-relaxed mb-4">
          Fixture: compile <code>input.html</code> to PDF (A4, 2cm margins) for{" "}
          <Money value={TEST_FIXTURE_SUMMARY.max_cost_usd} /> / {TEST_FIXTURE_SUMMARY.max_latency_s}s /{" "}
          {(TEST_FIXTURE_SUMMARY.min_confidence * 100).toFixed(0)}% confidence. This is{" "}
          <code>execution_mode: &quot;push&quot;</code> as your Auth0 session (or <code>local-dev</code>), not a
          simulated NeuraLake call and not a signed-only webhook bypass. Selection is pinned with{" "}
          <code>invite_agent_ids: [{agent.agent_id}]</code>. Without that field the marketplace would invite Top-K
          hireable <code>html_to_pdf</code> agents and prefer those with a webhook.
        </p>
        <button type="button" className="btn-ink" disabled={!canRun} onClick={() => void runTest()}>
          <span>{pending ? "Opening job…" : "Run test job"}</span>
          <strong>→</strong>
        </button>
        {!readiness.ready ? (
          <p className="mt-3 text-sm text-danger">Fix the blocking checks before the marketplace will accept a job.</p>
        ) : null}
        {error ? (
          <div className="mt-4 border border-[#d4a090] bg-paper/70 px-4 py-3">
            <p className="flex items-center gap-2">
              <Badge value={String(error.status || "err")} />
              <span className="text-sm text-danger">{error.message}</span>
            </p>
            {error.status === 503 ? (
              <p className="mt-2 text-sm text-[#53605a]">
                Same 503 the API returns when <code>MODEL_PROVIDER_API_KEY</code> is missing. There is no simulated
                inference path.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {job ? (
        <Panel
          title="Live job"
          eyebrow="RECEIVED → PLANS → SELECTED → DELIVERED"
          aside={
            <Link href={job.links.console} className="btn-ghost">
              Open ledger
            </Link>
          }
        >
          <dl className="grid gap-4 md:grid-cols-3 text-sm mb-5">
            <Stat
              label="request"
              value={
                <Link href={job.links.console} className="mono text-xs text-teal hover:underline">
                  {job.request_id}
                </Link>
              }
            />
            <Stat label="status" value={<Badge value={job.status} />} />
            <Stat label="invited" value={<span className="mono text-xs">{job.invited_agent_ids.join(", ") || "—"}</span>} />
          </dl>
          <PhaseRail steps={phaseSteps(job.status)} />
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {job.deliveries.map((delivery) => (
              <li key={delivery.agent_id} className="flex flex-wrap items-center gap-2">
                <Badge value={delivery.channel} />
                {delivery.webhook_ok === true ? <Badge value="webhook ok" /> : null}
                {delivery.webhook_ok === false ? <Badge value="webhook failed" /> : null}
                <span className="mono text-xs">{delivery.agent_id}</span>
                {delivery.webhook_ok === false ? (
                  <span className="text-[#53605a]">Inbox fallback — check HMAC, Worker URL, or BYOK.</span>
                ) : null}
              </li>
            ))}
            {job.skipped.map((skip) => (
              <li key={`${skip.agent_id}:${skip.reason}`} className="text-[#53605a]">
                skipped {skip.agent_id}: {skip.reason}
              </li>
            ))}
          </ul>
          {!job.targeted ? (
            <p className="mt-3 text-sm text-danger">
              This agent was not in the invite set. It is disabled, the wrong specialty, or not hireable.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {job ? (
        <LiveLedger
          requestId={job.request_id}
          initialStatus={job.status}
          initialEvents={[] as LedgerEvent[]}
          initialMetrics={EMPTY_METRICS}
        />
      ) : null}

      <Panel title={`Recent tests · ${recent.length}`} eyebrow="THIS AGENT">
        {recent.length === 0 ? (
          <Empty>No push jobs from your wallet have invited this agent yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((item) => (
              <li key={item.request_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link href={`/console/requests/${item.request_id}`} className="mono text-xs text-teal hover:underline">
                  {item.request_id}
                </Link>
                <span className="flex items-center gap-2">
                  <Badge value={item.status} />
                  <span className="mono text-xs text-muted">{new Date(item.created_at).toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
