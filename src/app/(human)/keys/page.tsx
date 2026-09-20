import Link from "next/link";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listOwnedAgents } from "@/lib/marketplace/sellers";
import { Badge, Empty, Money, PageIntro, Panel, Td, Th } from "@/app/console/ui";
import { ensureUserWallet } from "@/lib/marketplace/credits";
import { revokeOwnKey } from "./actions";
import { CreateBuyerKeyForm, CreateSellerKeyForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const { userId } = await requireSignedInPage();
  const { db } = await getDb();
  const [keyRows, agents, wallet] = await Promise.all([
    listApiKeys(db, { ownerUserId: userId }),
    listOwnedAgents(db, userId),
    ensureUserWallet(db, userId),
  ]);
  const keys = keyRows.map(toPublicApiKey);
  const buyer = keys.filter((k) => k.role === "buyer");
  const seller = keys.filter((k) => k.role === "seller");

  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="CREDENTIALS / SELF-SERVE"
        title={
          <>
            API <em>keys.</em>
          </>
        }
        lede={
          <>
            Mint your own credentials. Buyer keys call <code>POST /api/v1/requests</code>. Seller keys call{" "}
            <code>GET/PATCH /api/v1/agents/me</code>. The full secret is shown once.
          </>
        }
      />
      <p className="mono text-xs text-muted -mt-4">
        owner {userId} · wallet <Money value={wallet.capitalUsd} digits={2} /> test credits
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="New buyer key" eyebrow="CONSUMER AGENT">
          <CreateBuyerKeyForm />
        </Panel>
        <Panel
          title="New seller key"
          eyebrow="PROVIDER AGENT"
          aside={
            <Link href="/agents/register" className="btn-ghost">
              register an agent
            </Link>
          }
        >
          <CreateSellerKeyForm agents={agents.map((a) => ({ agentId: a.agentId, name: a.name }))} />
        </Panel>
      </div>

      <KeyTable title={`Buyer keys · ${buyer.length}`} keys={buyer} empty="No buyer keys yet." />
      <KeyTable title={`Seller keys · ${seller.length}`} keys={seller} empty="No seller keys yet." />
    </div>
  );
}

function KeyTable({
  title,
  keys,
  empty,
}: {
  title: string;
  keys: ReturnType<typeof toPublicApiKey>[];
  empty: string;
}) {
  return (
    <Panel title={title} eyebrow="HASHED PREFIXES">
      {keys.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <Th>id</Th>
              <Th>name</Th>
              <Th>prefix</Th>
              <Th>role</Th>
              <Th>agent</Th>
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
                  <Badge value={key.role} />
                </Td>
                <Td>
                  {key.agent_id ? (
                    <Link href={`/agents/${key.agent_id}`} className="mono text-xs text-teal hover:underline">
                      {key.agent_id}
                    </Link>
                  ) : (
                    <span className="mono text-xs text-muted">—</span>
                  )}
                </Td>
                <Td>
                  <Badge value={key.revoked_at ? "revoked" : "active"} />
                </Td>
                <Td right>
                  <span className="mono text-xs text-muted">{new Date(key.created_at).toLocaleString()}</span>
                </Td>
                <Td>
                  {!key.revoked_at ? (
                    <form action={revokeOwnKey}>
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
  );
}
