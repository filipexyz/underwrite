import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getRequestDetail } from "@/lib/marketplace/requests";
import { Badge, Empty, Money, NetworkStrip, PageIntro, Panel, Pct, PhaseRail, Stat, Td, Th } from "../../ui";
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

function settlementSteps(input: {
  status: string;
  planCount: number;
  escrowCount: number;
  released: boolean;
  withheld: boolean;
  verifyCount: number;
}) {
  const { status, planCount, escrowCount, released, withheld, verifyCount } = input;
  const step = (n: string, title: string, sub: string, done: boolean, active: boolean) => ({
    n,
    title,
    sub,
    state: (done ? "passed" : active ? "active" : "waiting") as "waiting" | "active" | "passed",
  });
  return [
    step("01", "Contract posted", "4 fields + failure policy", true, false),
    step("02", "Plans ranked", "conf · cost · latency · chain", planCount > 0, status === "auctioning" || status === "received"),
    step("03", "Escrow locked", "winning plan staked", escrowCount > 0, status === "contracting"),
    step(
      "04",
      "Dispatch",
      "selected agent works",
      ["verifying", "escalated", "completed", "failed"].includes(status) || verifyCount > 0,
      status === "executing",
    ),
    step("05", "Judge vs plan", "SLA / acceptance", verifyCount > 0 && (status === "completed" || status === "failed" || status === "escalated"), status === "verifying"),
    step(
      "06",
      released ? "Escrow released" : withheld ? "Escrow withheld" : "Settle",
      released ? "pay + certificate" : withheld ? "refund / escalate" : "awaiting verdict",
      status === "completed" || status === "failed",
      status === "escalated",
    ),
  ];
}

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
  const released = escrows.some((e) => e.status === "RELEASED");
  const withheld = escrows.some((e) => e.status === "WITHHELD" || e.status === "REFUNDED");
  const winner = plans.find((p) => p.status === "validated") ?? plans.find((p) => p.parentPlanId === null);
  const selectedBid = bids.find((b) => b.selected);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/console" className="eyebrow inline-block hover:text-ink">
          ← requests
        </Link>
        <PageIntro
          eyebrow="RUN EXPLAINER / THE MARKET DECISION"
          title={
            <>
              What happened to <em>this</em> task?
            </>
          }
          lede={request.requirement}
          action={
            <div className="flex flex-col items-end gap-2 text-right">
              <span className="mono text-xs text-muted">{request.requestId}</span>
              <Badge value={request.status} />
              <span className="mono text-xs">
                human_interventions:{" "}
                <span className={metrics.human_interventions === 0 ? "text-teal" : "text-danger"}>{metrics.human_interventions}</span>
              </span>
            </div>
          }
        />
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm border border-line bg-panel p-5">
        <Stat label="max cost" value={<Money value={request.maxCostUsd} />} />
        <Stat label="max latency" value={<span className="mono">{request.maxLatencyS}s</span>} />
        <Stat label="min confidence" value={<Pct value={request.minConfidence} />} />
        <Stat label="failure policy" value={<span className="mono">{request.failurePolicy}</span>} />
        <Stat label="total cost" value={<Money value={metrics.total_cost_usd} digits={5} />} />
        <Stat label="handoffs" value={<span className="mono">{metrics.handoffs}</span>} />
      </dl>

      <PhaseRail
        steps={settlementSteps({
          status: request.status,
          planCount: plans.length,
          escrowCount: escrows.length,
          released,
          withheld,
          verifyCount: verifications.length,
        })}
      />

      <NetworkStrip
        nodes={[
          { label: "BUYER", note: "task + stake", kind: "consumer" },
          { label: "MARKET", note: "rank + escrow", kind: "market" },
          { label: "AGENTS", note: winner?.agentId ?? "awaiting plan", kind: "providers" },
          { label: "JUDGE", note: latest ? latest.verdict : "verify vs plan", kind: "judge" },
          { label: "ESCROW", note: released ? "RELEASED" : withheld ? "WITHHELD" : "LOCKED", kind: "escrow" },
        ]}
      />

      {outcome.certificate ? (
        <section className="certificate">
          <p className="eyebrow !mb-2 !text-ink">SETTLEMENT COMPLETE / CERTIFICATE</p>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2 className="font-sans text-[34px] tracking-[-2px] font-semibold m-0 text-ink">
                Escrow released.
              </h2>
              <p className="mt-2 max-w-xl font-sans text-xs leading-relaxed text-ink/80">
                Delivered <Pct value={outcome.certificate.delivered_confidence} tone="good" /> · promised{" "}
                {Math.round(outcome.certificate.promised_confidence * 100)}%. Judges{" "}
                {outcome.certificate.judges_agree ? "agree" : "disagree"}. Chain {outcome.certificate.chain.join(" → ")}.
              </p>
            </div>
            <div className="flex flex-wrap gap-8 font-sans">
              <Stat label="price" value={<Money value={outcome.certificate.price_usd} />} />
              <Stat label="attempts / escalations" value={<span className="mono">{outcome.certificate.attempts} / {outcome.certificate.escalations}</span>} />
              <Stat label="elapsed (sim)" value={<span className="mono">{outcome.certificate.elapsed_s.toFixed(1)}s</span>} />
            </div>
          </div>
        </section>
      ) : null}

      {request.status === "failed" && outcome.reason ? (
        <section className="outcome-withheld">
          <p className="eyebrow !mb-2 !text-ink">SETTLEMENT COMPLETE / WITHHELD</p>
          <h2 className="font-sans text-[28px] tracking-[-1px] font-semibold m-0">Escrow withheld — honest failure.</h2>
          <p className="mt-2 text-sm leading-relaxed">{outcome.reason}</p>
        </section>
      ) : null}

      {request.error ? <p className="text-sm text-danger">{request.error}</p> : null}

      {(first || latest) && (
        <section className="grid gap-4 md:grid-cols-2">
          <Panel title="Promised vs delivered" eyebrow="SLA GATE">
            <div className="flex items-end gap-8">
              <div>
                <p className="eyebrow">promised (top plan)</p>
                <p className="text-3xl font-semibold">
                  <Pct value={topPromise} />
                </p>
              </div>
              {first && (
                <div>
                  <p className="eyebrow">delivered · attempt 1 ({first.producerAgentId})</p>
                  <p className="text-3xl font-semibold">
                    <Pct value={first.confidence.computed} tone={first.verdict === "pass" ? "good" : "bad"} />
                  </p>
                </div>
              )}
              {latest && latest !== first && (
                <div>
                  <p className="eyebrow">delivered · attempt {verifications.length} ({latest.producerAgentId})</p>
                  <p className="text-3xl font-semibold">
                    <Pct value={latest.confidence.computed} tone={latest.verdict === "pass" ? "good" : "bad"} />
                  </p>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Attribution" eyebrow="WALK-BACK">
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
        <Panel
          title="Provider plans"
          eyebrow="02 / RANK + SELECT"
          aside={selectedBid ? <Badge value="selected" /> : null}
        >
          {plans.length === 0 ? (
            <Empty>No plan published yet. Marketplace is requesting compliant plans (confidence, cost, latency, chain).</Empty>
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
                  <tr key={p.planId} className="border-t border-line">
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

        <Panel title="Bids (one round)" eyebrow="POLICY SCORE">
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
                  <tr key={b.bidId} className="border-t border-line">
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
                    <Td>
                      {b.selected ? (
                        <Badge value="selected" />
                      ) : b.compliant ? (
                        <span className="text-xs text-muted">compliant</span>
                      ) : (
                        <span className="text-xs text-danger">{b.rejectionReason}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </section>

      <Panel
        title="Chain & escrows"
        eyebrow="03 / LOCK → RELEASE OR WITHHOLD"
        aside={hops.length > 0 ? <span className="mono text-xs text-muted">{hops.map((h) => h.agent_id).join(" → ")}</span> : null}
      >
        {escrows.length === 0 ? (
          <Empty>No escrow locked yet. Stake locks on the winning plan before dispatch.</Empty>
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
                <tr key={e.escrowId} className="border-t border-line">
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

      {verifications.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {verifications.map((v, i) => (
            <Panel key={v.verificationId} title={`Verification · attempt ${i + 1} · ${v.producerAgentId}`} eyebrow="05 / JUDGE VS PLAN" aside={<Badge value={v.verdict} />}>
              <table className="w-full">
                <tbody>
                  {v.checks.map((c) => (
                    <tr key={c.check_id} className="border-t border-line/80">
                      <Td>
                        <span className={`mono text-xs ${c.passed ? "text-teal" : "text-danger"}`}>{c.passed ? "PASS" : "FAIL"}</span>
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

      <LiveLedger requestId={request.requestId} initialStatus={request.status} initialEvents={events} initialMetrics={metrics} />
    </div>
  );
}
