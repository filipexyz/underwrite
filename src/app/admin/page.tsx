import Link from "next/link";
import { desc } from "drizzle-orm";
import { Badge, Empty, Money, Panel, Td, Th } from "@/app/console/ui";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireAdminPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { ledgerEvents, wallets } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { listAllAgents, toPublicAgent } from "@/lib/marketplace/sellers";
import { listRequests } from "@/lib/marketplace/requests";
import { disableAgent, enableAgent, revokeAnyKey } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPage();
  const { db } = await getDb();
  const [agentRows, keyRows, requests, walletRows, events] = await Promise.all([
    listAllAgents(db),
    listApiKeys(db),
    listRequests(db, 20),
    db.select().from(wallets),
    db.select().from(ledgerEvents).orderBy(desc(ledgerEvents.seq)).limit(25),
  ]);
  const agents = agentRows.map(toPublicAgent);
  const keys = keyRows.map(toPublicApiKey);
  const capital = walletRows.reduce((sum, row) => sum + row.capitalUsd, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted">
          Configuration and audit only. Buyers and sellers mint their own keys. Seed catalog stays for demoday;
          registered sellers sit alongside.
        </p>
      </header>

      <Panel title="Safe knobs (env)">
        <ul className="text-sm flex flex-col gap-1.5">
          <li>
            <span className="mono text-xs text-muted">UNDERWRITE_API_KEY</span>{" "}
            {env.apiKey ? "set — legacy global bearer still accepted" : "unset — prefer DB buyer keys"}
          </li>
          <li>
            <span className="mono text-xs text-muted">UNDERWRITE_ADMIN_USER_IDS</span>{" "}
            {env.adminUserIds ? "set — bootstrap allowlist" : "unset — use Clerk publicMetadata.role=admin"}
          </li>
          <li>
            <span className="mono text-xs text-muted">Clerk public metadata</span>{" "}
            {`{ "role": "admin" }`} or {`{ "admin": true }`}
          </li>
        </ul>
      </Panel>

      <Panel title={`Agents · ${agents.length}`}>
        {agents.length === 0 ? (
          <Empty>
            Empty registry. <code>pnpm db:seed</code> loads A/B/C1/C2/J1/J2 — otherwise requests settle as{" "}
            <code>no_eligible_bid</code>.
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>agent</Th>
                <Th>name</Th>
                <Th>role</Th>
                <Th>status</Th>
                <Th>owner</Th>
                <Th>specialties</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agent_id} className="border-t border-border">
                  <Td>
                    <span className="mono text-xs">{agent.agent_id}</span>
                  </Td>
                  <Td>{agent.name}</Td>
                  <Td>
                    <Badge value={agent.role} />
                  </Td>
                  <Td>
                    <Badge value={agent.status} />
                  </Td>
                  <Td>
                    <span className="mono text-xs text-muted">{agent.owner_clerk_user_id ?? "—"}</span>
                  </Td>
                  <Td className="text-muted text-xs">{agent.specialties.join(", ")}</Td>
                  <Td>
                    {agent.status === "disabled" ? (
                      <form action={enableAgent}>
                        <input type="hidden" name="id" value={agent.agent_id} />
                        <button type="submit" className="text-xs text-accent hover:underline">
                          enable
                        </button>
                      </form>
                    ) : (
                      <form action={disableAgent}>
                        <input type="hidden" name="id" value={agent.agent_id} />
                        <button type="submit" className="text-xs text-danger hover:underline">
                          disable
                        </button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`API keys · ${keys.length}`}>
        {keys.length === 0 ? (
          <Empty>No hashed keys yet. Users mint them on /keys.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>id</Th>
                <Th>prefix</Th>
                <Th>role</Th>
                <Th>owner</Th>
                <Th>agent</Th>
                <Th>status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t border-border">
                  <Td>
                    <span className="mono text-xs">{key.id}</span>
                  </Td>
                  <Td>
                    <span className="mono text-xs">{key.key_prefix}…</span>
                  </Td>
                  <Td>
                    <Badge value={key.role} />
                  </Td>
                  <Td>
                    <span className="mono text-xs text-muted">{key.owner_clerk_user_id ?? "—"}</span>
                  </Td>
                  <Td>
                    <span className="mono text-xs text-muted">{key.agent_id ?? "—"}</span>
                  </Td>
                  <Td>
                    <Badge value={key.revoked_at ? "revoked" : "active"} />
                  </Td>
                  <Td>
                    {!key.revoked_at ? (
                      <form action={revokeAnyKey}>
                        <input type="hidden" name="id" value={key.id} />
                        <button type="submit" className="text-xs text-danger hover:underline">
                          revoke
                        </button>
                      </form>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Ledger summary" aside={<span className="mono text-xs text-muted">Σ wallets ${capital.toFixed(4)}</span>}>
          <p className="text-sm text-muted mb-3">{walletRows.length} wallets · {events.length} recent ledger rows</p>
          {events.length === 0 ? (
            <Empty>No ledger events yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {events.map((event) => (
                <li key={event.seq} className="flex gap-3">
                  <span className="mono text-muted w-8 shrink-0">{event.seq}</span>
                  <span className="mono">{event.type}</span>
                  <span className="mono text-muted truncate">{event.requestId}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent requests">
          {requests.length === 0 ? (
            <Empty>Nothing in the marketplace yet.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>request</Th>
                  <Th>status</Th>
                  <Th right>cost</Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.request_id} className="border-t border-border">
                    <Td>
                      <Link href={`/console/requests/${request.request_id}`} className="mono text-xs text-accent hover:underline">
                        {request.request_id}
                      </Link>
                    </Td>
                    <Td>
                      <Badge value={request.status} />
                    </Td>
                    <Td right>
                      <Money value={request.total_cost_usd} digits={5} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
