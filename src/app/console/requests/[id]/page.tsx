import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getRequestDetail } from "@/lib/marketplace/requests";
import { Badge, Empty, Money, Panel, Pct, Td, Th } from "../../ui";
import { LiveLedger } from "./live-ledger";

export const dynamic = "force-dynamic";

type Certificate = {
  delivered_confidence: number;
  promised_confidence: number;
  price_usd: number;
  chain: string[];
  attempts: number;
  escalations: number;
  elapsed_s: number;
  judges_agree: boolean;
};

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getDb();
  const detail = await getRequestDetail(db, id);
  if (!detail) notFound();

  const { request, metrics, events, bids, plans, escrows, verifications, attributions } = detail;
  const outcome = (request.outcome ?? {}) as { certificate?: Certificate; reason?: string };
  const hops = request.state?.hops ?? [];
  const latest = verifications.at(-1) ?? null;
  const first = verifications[0] ?? null;
  const topPromise = plans.find((p) => p.parentPlanId === null)?.promisedConfidence ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/console" className="text-xs text-muted hover:text-foreground">
          ← requests
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mono text-xl font-semibold tracking-tight">{request.requestId}</h1>
          <Badge value={request.status} />
          <span className="mono text-sm">
            human_interventions: <span className={metrics.human_interventions === 0 ? "text-accent" : "text-danger"}>{metrics.human_interventions}</span>
          </span>
        </div>
        <p className="text-sm text-muted">{request.requirement}</p>
        <dl className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm pt-1">
          <Stat label="max cost" value={<Money value={request.maxCostUsd} />} />
          <Stat label="max latency" value={<span className="mono">{request.maxLatencyS}s</span>} />
          <Stat label="min confidence" value={<Pct value={request.minConfidence} />} />
          <Stat label="failure policy" value={<span className="mono">{request.failurePolicy}</span>} />
          <Stat label="total cost" value={<Money value={metrics.total_cost_usd} digits={5} />} />
          <Stat label="handoffs" value={<span className="mono">{metrics.handoffs}</span>} />
        </dl>
        {request.error && <p className="text-sm text-danger">{request.error}</p>}
      </header>

      {outcome.certificate && (
        <section className="rounded-lg border border-accent/40 bg-accent/5 p-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted">certificate</p>
            <p className="text-2xl font-semibold">
              <Pct value={outcome.certificate.delivered_confidence} tone="good" />{" "}
              <span className="text-sm text-muted font-normal">delivered · promised {Math.round(outcome.certificate.promised_confidence * 100)}%</span>
            </p>
          </div>
          <Stat label="price" value={<Money value={outcome.certificate.price_usd} />} />
          <Stat label="chain" value={<span className="mono text-xs">{outcome.certificate.chain.join(" → ")}</span>} />
          <Stat label="attempts / escalations" value={<span className="mono">{outcome.certificate.attempts} / {outcome.certificate.escalations}</span>} />
          <Stat label="elapsed (sim)" value={<span className="mono">{outcome.certificate.elapsed_s.toFixed(1)}s</span>} />
          <Stat label="judges" value={<span className="mono">{outcome.certificate.judges_agree ? "agree" : "disagree"}</span>} />
        </section>
      )}
      {request.status === "failed" && outcome.reason && (
        <section className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted">honest failure</p>
          <p>{outcome.reason}</p>
        </section>
      )}

      {(first || latest) && (
        <section className="grid gap-4 md:grid-cols-2">
          <Panel title="Promised vs delivered">
            <div className="flex items-end gap-8">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted">promised (top plan)</p>
                <p className="text-3xl font-semibold">
                  <Pct value={topPromise} />
                </p>
              </div>
              {first && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">delivered · attempt 1 ({first.producerAgentId})</p>
                  <p className="text-3xl font-semibold">
                    <Pct value={first.confidence.computed} tone={first.verdict === "pass" ? "good" : "bad"} />
                  </p>
                </div>
              )}
              {latest && latest !== first && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">delivered · attempt {verifications.length} ({latest.producerAgentId})</p>
                  <p className="text-3xl font-semibold">
                    <Pct value={latest.confidence.computed} tone={latest.verdict === "pass" ? "good" : "bad"} />
                  </p>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Attribution">
            {attributions.length === 0 ? (
              <Empty>No failure to attribute{request.status === "completed" ? " — first delivery met the SLA." : "."}</Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {attributions.map((a) => (
                  <li key={a.attributionId} className="text-sm">
                    <p className="flex items-center gap-2">
                      <Badge value={a.rootCause} />
                      <span className="mono">
                        failed at <strong>{a.failedHop}</strong> · blamed <strong className="text-danger">{a.blamedAgent ?? "nobody"}</strong>
                      </span>
                    </p>
                    <p className="text-muted pt-1">{a.explanation}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Panel title="Bids (one round)">
          {bids.length === 0 ? (
            <Empty>Auction not run yet.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>agent</Th>
                  <Th right>price</Th>
                  <Th right>confidence</Th>
                  <Th right>latency</Th>
                  <Th>chain</Th>
                  <Th>outcome</Th>
                </tr>
              </thead>
              <tbody>
                {bids.map((b) => (
                  <tr key={b.bidId} className="border-t border-border">
                    <Td>
                      <span className="mono text-xs">{b.agentId}</span>
                    </Td>
                    <Td right>
                      <Money value={b.costUsd} />
                    </Td>
                    <Td right>
                      <Pct value={b.confidence} />
                    </Td>
                    <Td right>
                      <span className="mono">{b.latencyS}s</span>
                    </Td>
                    <Td>
                      <span className="mono text-xs text-muted">{b.chain.map((h) => h.agent_id).join(" → ")}</span>
                    </Td>
                    <Td>{b.selected ? <Badge value="selected" /> : b.compliant ? <span className="text-xs text-muted">compliant</span> : <span className="text-xs text-danger">{b.rejectionReason}</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Chain & escrows" aside={hops.length > 0 ? <span className="mono text-xs text-muted">{hops.map((h) => h.agent_id).join(" → ")}</span> : null}>
          {escrows.length === 0 ? (
            <Empty>No escrow locked yet.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>hop</Th>
                  <Th>payer → payee</Th>
                  <Th right>amount</Th>
                  <Th right>stake</Th>
                  <Th right>floor</Th>
                  <Th>status</Th>
                </tr>
              </thead>
              <tbody>
                {escrows.map((e) => (
                  <tr key={e.escrowId} className="border-t border-border">
                    <Td>
                      <span className="mono">{e.hopIndex}</span>
                    </Td>
                    <Td>
                      <span className="mono text-xs">
                        {e.payerAgentId ?? "buyer"} → {e.payeeAgentId}
                      </span>
                    </Td>
                    <Td right>
                      <Money value={e.amountUsd} />
                    </Td>
                    <Td right>
                      <Money value={e.stakeUsd} />
                    </Td>
                    <Td right>
                      <Pct value={e.minConfidence} />
                    </Td>
                    <Td>
                      <Badge value={e.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </section>

      {verifications.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {verifications.map((v, i) => (
            <Panel key={v.verificationId} title={`Verification · attempt ${i + 1} · ${v.producerAgentId}`} aside={<Badge value={v.verdict} />}>
              <table className="w-full">
                <tbody>
                  {v.checks.map((c) => (
                    <tr key={c.check_id} className="border-t border-border/60">
                      <Td>
                        <span className={`mono text-xs ${c.passed ? "text-accent" : "text-danger"}`}>{c.passed ? "PASS" : "FAIL"}</span>
                      </Td>
                      <Td>
                        <span className="mono text-xs">{c.check_id}</span>
                      </Td>
                      <Td className="text-muted">{c.detail}</Td>
                      <Td right>
                        <span className="mono text-xs text-muted">w{c.weight}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="grid grid-cols-3 md:grid-cols-6 gap-2 pt-3 text-xs">
                <Stat label="objective" value={<Pct value={v.confidence.objective} />} />
                <Stat label="agreement" value={<Pct value={v.confidence.agreement} />} />
                <Stat label="track record" value={<Pct value={v.confidence.track_record} />} />
                <Stat label="process" value={<Pct value={v.confidence.process} />} />
                <Stat label="self-report (suspect)" value={<Pct value={v.confidence.self_report} />} />
                <Stat label={`computed · ${v.confidence.method}`} value={<Pct value={v.confidence.computed} tone={v.verdict === "pass" ? "good" : "bad"} />} />
              </dl>
              {v.judges.length > 0 && (
                <p className="pt-3 text-xs text-muted mono">
                  judges: {v.judges.map((j) => `${j.judge_id} (${j.model_family}) ${j.verdict}`).join(" · ")} {v.judgesDisagree ? "— DISAGREE" : "— agree"}
                </p>
              )}
            </Panel>
          ))}
        </section>
      )}

      <Panel title="Plans (the plan is the contract)">
        {plans.length === 0 ? (
          <Empty>No plan published yet.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>agent</Th>
                <Th>strategy</Th>
                <Th right>promised</Th>
                <Th right>max cost</Th>
                <Th right>deadline</Th>
                <Th>declared chain</Th>
                <Th>status</Th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.planId} className="border-t border-border">
                  <Td>
                    <span className="mono text-xs">{p.agentId}</span>
                    {p.supersedesPlanId && <span className="ml-2 text-xs text-warn">re-plan</span>}
                  </Td>
                  <Td>
                    <span className="mono text-xs">{p.strategyChosen}</span>
                  </Td>
                  <Td right>
                    <Pct value={p.promisedConfidence} />
                  </Td>
                  <Td right>
                    <Money value={p.maxCostUsd} />
                  </Td>
                  <Td right>
                    <span className="mono">{p.estLatencyS}s</span>
                  </Td>
                  <Td>
                    <span className="mono text-xs text-muted">{p.chain.map((h) => `${h.agent_id} $${h.cost_usd}`).join(" → ")}</span>
                  </Td>
                  <Td>
                    <Badge value={p.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <LiveLedger requestId={request.requestId} initialStatus={request.status} initialEvents={events} initialMetrics={metrics} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="pt-0.5">{value}</dd>
    </div>
  );
}
