import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listRequests } from "@/lib/marketplace/requests";
import { fireDemoRequest, resetCatalog } from "./actions";
import { Badge, Empty, Money, PageIntro, Panel, Pct, Td, Th } from "./ui";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const { db } = await getDb();
  const rows = await listRequests(db);

  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="INTERNAL / AGENT WORKFLOW OBSERVABILITY"
        title={
          <>
            One task. <em>Every handoff.</em>
          </>
        }
        lede="Every request an agent (or you, once) fired at the marketplace. Click one for the live settlement ledger. Trust is memory: after one run A stops hiring B. Reset the catalog to replay the escalation scene."
        action={
          <>
            <form action={fireDemoRequest}>
              <button type="submit" className="btn-ink w-full min-w-[280px]">
                <span>Fire demo request</span>
                <strong>→</strong>
              </button>
            </form>
            <form action={resetCatalog}>
              <button
                type="submit"
                title="Restore seeded axes, wallets and an empty pairwise-trust graph. The ledger is never touched."
                className="btn-ghost w-full justify-between"
              >
                Reset catalog
              </button>
            </form>
          </>
        }
      />

      <Panel title={`${rows.length} request${rows.length === 1 ? "" : "s"}`} eyebrow="MARKET LEDGER" aside={<Badge value="live" />}>
        {rows.length === 0 ? (
          <Empty>
            Waiting for a mandate. Fire the demo above, or <code>POST /api/v1/requests</code> as an agent.
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>request</Th>
                <Th>status</Th>
                <Th>requirement</Th>
                <Th right>min conf</Th>
                <Th right>delivered</Th>
                <Th right>max $</Th>
                <Th right>cost</Th>
                <Th right>escalations</Th>
                <Th right>created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.request_id} className="border-t border-line hover:bg-paper/80">
                  <Td>
                    <Link href={`/console/requests/${r.request_id}`} className="mono text-xs text-teal hover:underline">
                      {r.request_id}
                    </Link>
                  </Td>
                  <Td>
                    <Badge value={r.status} />
                  </Td>
                  <Td className="max-w-md truncate text-muted">{r.requirement}</Td>
                  <Td right>
                    <Pct value={r.min_confidence} />
                  </Td>
                  <Td right>
                    <Pct value={r.delivered_confidence} tone="auto" />
                  </Td>
                  <Td right>
                    <Money value={r.max_cost_usd} />
                  </Td>
                  <Td right>
                    <Money value={r.total_cost_usd} digits={5} />
                  </Td>
                  <Td right>
                    <span className="mono">{r.escalations}</span>
                  </Td>
                  <Td right>
                    <span className="mono text-xs text-muted">{new Date(r.created_at).toLocaleTimeString()}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
