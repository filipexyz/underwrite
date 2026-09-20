import Link from "next/link";
import { desc } from "drizzle-orm";
import { Badge, Empty, Money, PageIntro, Panel, Td, Th } from "@/app/console/ui";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { listRegistrations, toPublicRegistration } from "@/lib/auth/auth-md";
import { requireAdminPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { ledgerEvents, wallets } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { classifyWallet } from "@/lib/marketplace/credits";
import { listAllAgents, toPublicAgent } from "@/lib/marketplace/sellers";
import { listRequests } from "@/lib/marketplace/requests";
import { disableAgent, enableAgent, revokeAnyKey, revokeAnyRegistration } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPage();
  const { db } = await getDb();
  const [agentRows, keyRows, requests, walletRows, events, registrationRows] = await Promise.all([
    listAllAgents(db),
    listApiKeys(db),
    listRequests(db, 20),
    db.select().from(wallets),
    db.select().from(ledgerEvents).orderBy(desc(ledgerEvents.seq)).limit(25),
    listRegistrations(db, 40),
  ]);
  const registrations = registrationRows.map(toPublicRegistration);
  const agents = agentRows.map(toPublicAgent);
  const keys = keyRows.map(toPublicApiKey);
  const capital = walletRows.reduce((sum, row) => sum + row.capitalUsd, 0);
  const agentIds = new Set(agentRows.map((row) => row.agentId));
  const walletByOwner = new Map(walletRows.map((row) => [row.ownerId, row]));
  const walletsSorted = [...walletRows].sort((a, b) => b.capitalUsd - a.capitalUsd || a.ownerId.localeCompare(b.ownerId));

  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="INTERNAL / CONFIGURATION + AUDIT"
        title={
          <>
            Ops <em>console.</em>
          </>
        }
        lede="Configuration and audit only. Buyers and sellers mint their own keys. Seed catalog stays for demoday; registered sellers sit alongside."
      />

      <Panel title="Safe knobs (env)" eyebrow="DEPLOYMENT KEY">
        <ul className="text-sm flex flex-col">
          <li className="flex justify-between gap-4 border-t border-line py-2.5 font-mono text-[10px] tracking-wide first:border-t-0">
            <b className="text-teal">UNDERWRITE_API_KEY</b>
            <span className="text-right text-[#5c6862]">{env.apiKey ? "set — legacy global bearer still accepted" : "unset — prefer DB buyer keys"}</span>
          </li>
          <li className="flex justify-between gap-4 border-t border-line py-2.5 font-mono text-[10px] tracking-wide">
            <b className="text-teal">UNDERWRITE_ADMIN_USER_IDS</b>
            <span className="text-right text-[#5c6862]">{env.adminUserIds ? "set — bootstrap allowlist" : "unset — use Auth0 https://underwrite/roles"}</span>
          </li>
          <li className="flex justify-between gap-4 border-t border-line py-2.5 font-mono text-[10px] tracking-wide">
            <b className="text-teal">Auth0 admin claim</b>
            <span className="text-right text-[#5c6862]">app_metadata.role=admin → https://underwrite/roles</span>
          </li>
          <li className="flex justify-between gap-4 border-t border-line py-2.5 font-mono text-[10px] tracking-wide">
            <b className="text-teal">MODEL_PROVIDER_API_KEY</b>
            <span className="text-right text-[#5c6862]">
              {env.modelProvider.enabled
                ? `${env.modelProvider.name} · ${env.modelProvider.model} · ${env.modelProvider.baseUrl}`
                : "unset — POST /api/v1/requests returns 503 (no simulated inference)"}
            </span>
          </li>
        </ul>
      </Panel>

      <Panel title={`Agents · ${agents.length}`} eyebrow="FULL REGISTRY">
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
                <Th right>wallet</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agent_id} className="border-t border-line">
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
                    <span className="mono text-xs text-muted">{agent.owner_user_id ?? "—"}</span>
                  </Td>
                  <Td className="text-muted text-xs">{agent.specialties.join(", ")}</Td>
                  <Td right>
                    <Money value={walletByOwner.get(agent.agent_id)?.capitalUsd} digits={2} />
                  </Td>
                  <Td>
                    {agent.status === "disabled" ? (
                      <form action={enableAgent}>
                        <input type="hidden" name="id" value={agent.agent_id} />
                        <button type="submit" className="font-mono text-[10px] tracking-wider uppercase text-teal hover:underline">
                          enable
                        </button>
                      </form>
                    ) : (
                      <form action={disableAgent}>
                        <input type="hidden" name="id" value={agent.agent_id} />
                        <button type="submit" className="font-mono text-[10px] tracking-wider uppercase text-danger hover:underline">
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

      <Panel title={`API keys · ${keys.length}`} eyebrow="HASHED CREDENTIALS">
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
                <tr key={key.id} className="border-t border-line">
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
                    <span className="mono text-xs text-muted">{key.owner_user_id ?? "—"}</span>
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
                        <button type="submit" className="font-mono text-[10px] tracking-wider uppercase text-danger hover:underline">
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

      <Panel title={`auth.md registrations · ${registrations.length}`} eyebrow="AGENT IDENTITY">
        {registrations.length === 0 ? (
          <Empty>
            No agent registrations yet. Agents start at <code>/auth.md</code>.
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>id</Th>
                <Th>type</Th>
                <Th>status</Th>
                <Th>owner</Th>
                <Th>agent</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => (
                <tr key={registration.registration_id} className="border-t border-line">
                  <Td>
                    <span className="mono text-xs">{registration.registration_id}</span>
                  </Td>
                  <Td>
                    <Badge value={registration.registration_type} />
                  </Td>
                  <Td>
                    <Badge value={registration.status} />
                  </Td>
                  <Td>
                    <span className="mono text-xs text-muted">{registration.owner_user_id ?? "—"}</span>
                  </Td>
                  <Td>
                    <span className="mono text-xs text-muted">{registration.agent_id ?? "—"}</span>
                  </Td>
                  <Td>
                    {registration.status !== "revoked" ? (
                      <form action={revokeAnyRegistration}>
                        <input type="hidden" name="id" value={registration.registration_id} />
                        <button type="submit" className="font-mono text-[10px] tracking-wider uppercase text-danger hover:underline">
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

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Wallets" eyebrow="BALANCES" aside={<span className="mono text-xs text-muted">Σ <Money value={capital} digits={2} /></span>}>
          <table className="w-full">
            <thead>
              <tr>
                <Th>owner</Th>
                <Th>kind</Th>
                <Th right>balance</Th>
              </tr>
            </thead>
            <tbody>
              {walletsSorted.map((wallet) => (
                <tr key={wallet.ownerId} className="border-t border-line">
                  <Td>
                    <span className="mono text-xs">{wallet.ownerId}</span>
                  </Td>
                  <Td>
                    <Badge value={classifyWallet(wallet.ownerId, agentIds)} />
                  </Td>
                  <Td right>
                    <Money value={wallet.capitalUsd} digits={2} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Ledger summary" eyebrow="RECENT ROWS" aside={<span className="mono text-xs text-muted">{events.length} recent</span>}>
          <p className="text-sm text-[#53605a] mb-3">{walletRows.length} wallets · {events.length} recent ledger rows</p>
          {events.length === 0 ? (
            <Empty>No ledger events yet.</Empty>
          ) : (
            <ul className="flex flex-col text-xs">
              {events.map((event) => (
                <li key={event.seq} className="flex gap-3 border-t border-line py-2 font-mono first:border-t-0">
                  <span className="text-muted w-8 shrink-0">{event.seq}</span>
                  <span>{event.type}</span>
                  <span className="text-muted truncate">{event.requestId}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent requests" eyebrow="MARKET">
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
                  <tr key={request.request_id} className="border-t border-line">
                    <Td>
                      <Link href={`/console/requests/${request.request_id}`} className="mono text-xs text-teal hover:underline">
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
