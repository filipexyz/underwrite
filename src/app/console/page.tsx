import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listRequests } from "@/lib/marketplace/requests";
import { fireDemoRequest, resetCatalog } from "./actions";
import { Badge, Empty, Money, Panel, Pct, Td, Th } from "./ui";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const { db } = await getDb();
  const rows = await listRequests(db);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted">Every request an agent (or you, once) fired at the marketplace. Click one for the live ledger.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <form action={resetCatalog}>
              <button
                type="submit"
                title="Restore seeded axes, wallets and an empty pairwise-trust graph. The ledger is never touched."
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-panel"
              >
                Reset catalog
              </button>
            </form>
            <form action={fireDemoRequest}>
              <button type="submit" className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90">
                Fire demo request
              </button>
            </form>
          </div>
          <p className="text-xs text-muted">Trust is memory: after one run A stops hiring B. Reset the catalog to replay the escalation scene.</p>
        </div>
      </header>

      <Panel title={`${rows.length} request${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty>
            Nothing yet. Fire the demo above, or <code>POST /api/v1/requests</code> as an agent.
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
                <tr key={r.request_id} className="border-t border-border hover:bg-background/40">
                  <Td>
                    <Link href={`/console/requests/${r.request_id}`} className="mono text-xs text-accent hover:underline">
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
