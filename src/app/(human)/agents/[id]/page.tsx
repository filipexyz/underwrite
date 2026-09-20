import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty, Money, PageIntro, Panel, Stat, Td, Th } from "@/app/console/ui";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { peekIssuedAgentSecrets } from "@/lib/auth/issued-secret";
import { requireSignedInPage } from "@/lib/auth/session";
import { SecretBanner } from "@/components/secret-banner";
import { Timestamp } from "@/components/timestamp";
import { getDb } from "@/lib/db/client";
import { getPublicAgentRuntime } from "@/lib/marketplace/agent-runtime";
import { ensureAgentWallet } from "@/lib/marketplace/credits";
import { getOwnedAgent, toPublicAgent } from "@/lib/marketplace/sellers";
import { revokeOwnedSellerKey, setOwnedAgentDisabled } from "./actions";
import { EditAgentForm, MintSellerKeyForm, RuntimeForm } from "./manage";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireSignedInPage();
  const { id } = await params;
  const { db } = await getDb();
  const row = await getOwnedAgent(db, id, userId);
  if (!row) notFound();

  const [wallet, keyRows, issued, runtime] = await Promise.all([
    ensureAgentWallet(db, row.agentId),
    listApiKeys(db, { ownerUserId: userId, agentId: row.agentId }),
    peekIssuedAgentSecrets(row.agentId),
    getPublicAgentRuntime(db, row.agentId, row.webhookUrl),
  ]);
  const agent = toPublicAgent(row);
  const keys = keyRows.map(toPublicApiKey);
  const disabled = agent.status === "disabled";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/agents" className="eyebrow inline-block hover:text-ink">
          ← all agents
        </Link>
        <PageIntro
          eyebrow="PROVIDER DETAIL / MANIFEST"
          title={agent.name}
          lede="This agent’s identity, seller key, webhook, and BYOK are isolated from every other user. Disabled agents drop out of marketplace invites."
          action={
            <div className="flex flex-col items-end gap-2">
              <span className="mono text-xs text-muted">{agent.agent_id}</span>
              <div className="flex gap-2">
                <Badge value={agent.status} />
                <Badge value={agent.role} />
              </div>
              <Link href={`/agents/${agent.agent_id}/test`} className="btn-ink">
                <span>Test on Cloudflare</span>
                <strong>→</strong>
              </Link>
            </div>
          }
        />
      </div>

      {issued.seller ? <SecretBanner secret={issued.seller} label="seller secret" /> : null}
      {issued.webhook ? <SecretBanner secret={issued.webhook} label="webhook HMAC secret" /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Wallet" eyebrow="EARNINGS" aside={<Badge value="agent" />}>
          <p className="text-[42px] font-semibold tracking-tight leading-none">
            <Money value={wallet.capitalUsd} digits={2} />
          </p>
          <p className="text-sm text-[#53605a] mt-3">Starts at $0.00. Earns by being hired — no starting grant.</p>
        </Panel>
        <Panel
          title="Status"
          eyebrow="MARKET ACCESS"
          aside={
            <form action={setOwnedAgentDisabled}>
              <input type="hidden" name="agent_id" value={agent.agent_id} />
              <input type="hidden" name="status" value={disabled ? "registered" : "disabled"} />
              <button type="submit" className={disabled ? "btn-ink" : "btn-ghost"}>
                {disabled ? "Enable agent" : "Disable agent"}
              </button>
            </form>
          }
        >
          <p className="text-sm text-[#53605a] leading-relaxed">
            {disabled
              ? "This agent will not receive auction invites or submit bids until you enable it."
              : "This agent is hireable. Disable it to pull it out of the marketplace without deleting the row."}
          </p>
          <p className="mono text-xs text-muted mt-3">created <Timestamp value={agent.created_at} /></p>
        </Panel>
      </div>

      <Panel title="Manifest" eyebrow="DECLARED CAPABILITY">
        <dl className="grid gap-4 md:grid-cols-2 text-sm">
          <Stat label="name" value={agent.name} />
          <Stat label="role" value={agent.role} />
          <Stat label="status" value={agent.status} />
          <Stat label="specialties" value={agent.specialties.join(", ")} />
          <Stat label="model family" value={agent.model_family} />
          <Stat label="model" value={agent.model} />
          <Stat label="baseline confidence" value={String(agent.baseline_confidence)} />
          <Stat label="cost ceiling usd" value={`$${agent.cost_ceiling_usd}`} />
          <Stat label="latency class" value={agent.latency_class} />
          <Stat label="risk tolerance" value={agent.risk_tolerance} />
          <Stat label="contact" value={agent.contact ?? "—"} />
          <Stat label="webhook url" value={<span className="break-all">{agent.webhook_url ?? "—"}</span>} />
          <Stat label="description" value={agent.description ?? "—"} />
          <Stat label="owner" value={<span className="mono text-xs">{agent.owner_user_id ?? "—"}</span>} />
          <Stat label="created" value={<Timestamp value={agent.created_at} />} />
          <Stat label="updated" value={<Timestamp value={agent.updated_at} />} />
        </dl>
      </Panel>

      <Panel title="Hosted runtime" eyebrow="PER-AGENT IDENTITY" aside={<Badge value={runtime.kind} />}>
        <dl className="grid gap-4 md:grid-cols-2 text-sm mb-6">
          <Stat label="kind" value={runtime.kind} />
          <Stat label="webhook" value={<span className="break-all">{runtime.webhook_url ?? "inbox fallback"}</span>} />
          <Stat label="HMAC secret" value={runtime.webhook_secret_configured ? "configured" : "missing"} />
          <Stat label="BYOK" value={runtime.byok_configured ? "configured" : "not set"} />
          <Stat label="BYOK base" value={runtime.byok_base_url ?? "NeuraLake default"} />
          <Stat label="provisioned" value={runtime.provisioned ? "yes" : "pending / inbox"} />
          <Stat label="last error" value={runtime.last_error ?? "—"} />
        </dl>
        <RuntimeForm agentId={agent.agent_id} runtime={runtime} />
      </Panel>

      <Panel title="Edit" eyebrow="UPDATE MANIFEST">
        <EditAgentForm agent={agent} hosted={runtime.kind === "hosted"} />
      </Panel>

      <Panel title="Seller keys" eyebrow="PREFIXES ONLY" aside={<span className="eyebrow !mb-0">shown once</span>}>
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
                <tr key={key.id} className="border-t border-line">
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
                    <Timestamp value={key.created_at} className="mono text-xs text-muted" />
                  </Td>
                  <Td>
                    {!key.revoked_at ? (
                      <form action={revokeOwnedSellerKey}>
                        <input type="hidden" name="id" value={key.id} />
                        <input type="hidden" name="agent_id" value={agent.agent_id} />
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
    </div>
  );
}
