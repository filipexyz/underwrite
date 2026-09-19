import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty, Money, Panel, Td, Th } from "@/app/console/ui";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { peekIssuedSellerSecret } from "@/lib/auth/issued-secret";
import { requireSignedInPage } from "@/lib/auth/session";
import { SecretBanner } from "@/components/secret-banner";
import { getDb } from "@/lib/db/client";
import { ensureAgentWallet } from "@/lib/marketplace/credits";
import { getOwnedAgent, toPublicAgent } from "@/lib/marketplace/sellers";
import { revokeOwnedSellerKey, setOwnedAgentDisabled } from "./actions";
import { EditAgentForm, MintSellerKeyForm } from "./manage";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireSignedInPage();
  const { id } = await params;
  const { db } = await getDb();
  const row = await getOwnedAgent(db, id, userId);
  if (!row) notFound();

  const [wallet, keyRows, issuedSecret] = await Promise.all([
    ensureAgentWallet(db, row.agentId),
    listApiKeys(db, { ownerClerkUserId: userId, agentId: row.agentId }),
    peekIssuedSellerSecret(row.agentId),
  ]);
  const agent = toPublicAgent(row);
  const keys = keyRows.map(toPublicApiKey);
  const disabled = agent.status === "disabled";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm">
          <Link href="/agents" className="text-accent hover:underline">
            ← all agents
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          <Badge value={agent.status} />
          <Badge value={agent.role} />
        </div>
        <p className="mono text-xs text-muted">{agent.agent_id}</p>
        <p className="text-sm text-muted">
          Owner management for this hireable agent. Disabled agents are excluded from auction invites and bids. The
          seller wallet starts at $0 and earns when hired.
        </p>
      </header>

      {issuedSecret ? <SecretBanner secret={issuedSecret} label="seller secret" /> : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Wallet" aside={<Badge value="agent" />}>
          <p className="text-3xl font-semibold tracking-tight">
            <Money value={wallet.capitalUsd} digits={2} />
          </p>
          <p className="text-sm text-muted mt-2">Starts at $0.00. Earns by being hired — no starting grant.</p>
        </Panel>
        <Panel
          title="Status"
          aside={
            <form action={setOwnedAgentDisabled}>
              <input type="hidden" name="agent_id" value={agent.agent_id} />
              <input type="hidden" name="status" value={disabled ? "registered" : "disabled"} />
              <button
                type="submit"
                className={`text-sm hover:underline ${disabled ? "text-accent" : "text-danger"}`}
              >
                {disabled ? "Enable agent" : "Disable agent"}
              </button>
            </form>
          }
        >
          <p className="text-sm text-muted">
            {disabled
              ? "This agent will not receive auction invites or submit bids until you enable it."
              : "This agent is hireable. Disable it to pull it out of the marketplace without deleting the row."}
          </p>
          <p className="mono text-xs text-muted mt-3">created {new Date(agent.created_at).toLocaleString()}</p>
        </Panel>
      </div>

      <Panel title="Manifest">
        <dl className="grid gap-3 md:grid-cols-2 text-sm">
          <Item label="name" value={agent.name} />
          <Item label="role" value={agent.role} />
          <Item label="status" value={agent.status} />
          <Item label="specialties" value={agent.specialties.join(", ")} />
          <Item label="model family" value={agent.model_family} />
          <Item label="model" value={agent.model} />
          <Item label="baseline confidence" value={String(agent.baseline_confidence)} />
          <Item label="cost ceiling usd" value={`$${agent.cost_ceiling_usd}`} />
          <Item label="latency class" value={agent.latency_class} />
          <Item label="risk tolerance" value={agent.risk_tolerance} />
          <Item label="contact" value={agent.contact ?? "—"} />
          <Item label="webhook url" value={agent.webhook_url ?? "—"} />
          <Item label="description" value={agent.description ?? "—"} />
          <Item label="owner" value={agent.owner_clerk_user_id ?? "—"} />
          <Item label="created" value={new Date(agent.created_at).toLocaleString()} />
          <Item label="updated" value={new Date(agent.updated_at).toLocaleString()} />
        </dl>
      </Panel>

      <Panel title="Edit">
        <EditAgentForm agent={agent} />
      </Panel>

      <Panel title="Seller keys" aside={<span className="text-xs text-muted">prefixes only</span>}>
        <MintSellerKeyForm agentId={agent.agent_id} agentName={agent.name} />
        {keys.length === 0 ? (
          <Empty>No seller keys bound to this agent yet.</Empty>
        ) : (
          <table className="w-full mt-4">
            <thead>
              <tr>
                <Th>id</Th>
                <Th>name</Th>
                <Th>prefix</Th>
                <Th>status</Th>
                <Th right>created</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t border-border">
                  <Td>
                    <span className="mono text-xs">{key.id}</span>
                  </Td>
                  <Td>{key.name}</Td>
                  <Td>
                    <span className="mono text-xs">{key.key_prefix}…</span>
                  </Td>
                  <Td>
                    <Badge value={key.revoked_at ? "revoked" : "active"} />
                  </Td>
                  <Td right>
                    <span className="mono text-xs text-muted">{new Date(key.created_at).toLocaleString()}</span>
                  </Td>
                  <Td>
                    {!key.revoked_at ? (
                      <form action={revokeOwnedSellerKey}>
                        <input type="hidden" name="id" value={key.id} />
                        <input type="hidden" name="agent_id" value={agent.agent_id} />
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
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
