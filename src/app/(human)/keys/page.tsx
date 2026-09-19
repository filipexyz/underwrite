import Link from "next/link";
import { listApiKeys, toPublicApiKey } from "@/lib/auth/api-keys";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listOwnedAgents } from "@/lib/marketplace/sellers";
import { Badge, Empty, Money, Panel, Td, Th } from "@/app/console/ui";
import { ensureUserWallet } from "@/lib/marketplace/credits";
import { revokeOwnKey } from "./actions";
import { CreateBuyerKeyForm, CreateSellerKeyForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const { userId } = await requireSignedInPage();
  const { db } = await getDb();
  const [keyRows, agents, wallet] = await Promise.all([
    listApiKeys(db, { ownerClerkUserId: userId }),
    listOwnedAgents(db, userId),
    ensureUserWallet(db, userId),
  ]);
  const keys = keyRows.map(toPublicApiKey);
  const buyer = keys.filter((k) => k.role === "buyer");
  const seller = keys.filter((k) => k.role === "seller");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted">
          Mint your own credentials. Buyer keys call <code>POST /api/v1/requests</code>. Seller keys call{" "}
          <code>GET/PATCH /api/v1/agents/me</code>. The full secret is shown once.
        </p>
        <p className="mono text-xs text-muted">
          owner {userId} · wallet <Money value={wallet.capitalUsd} digits={2} /> test credits
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="New buyer key">
          <CreateBuyerKeyForm />
        </Panel>
        <Panel
          title="New seller key"
          aside={
            <Link href="/agents/register" className="text-xs text-accent hover:underline">
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
    <Panel title={title}>
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
              <tr key={key.id} className="border-t border-border">
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
                  <span className="mono text-xs text-muted">{key.agent_id ?? "—"}</span>
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
  );
}
