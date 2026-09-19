import Link from "next/link";
import { Badge, Empty, Money, Panel, Td, Th } from "@/app/console/ui";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { STARTING_TEST_CREDITS_USD, ensureUserWallet, getWallet } from "@/lib/marketplace/credits";
import { listOwnedAgents } from "@/lib/marketplace/sellers";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { userId } = await requireSignedInPage();
  const { db } = await getDb();
  const [wallet, agents] = await Promise.all([ensureUserWallet(db, userId), listOwnedAgents(db, userId)]);
  const agentWallets = await Promise.all(
    agents.map(async (agent) => ({ agent, wallet: await getWallet(db, agent.agentId) })),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted">
          Test-credit wallet for this Clerk user. Buyer keys debit this balance on escrow lock; refunds credit it
          back. No real money.
        </p>
        <p className="mono text-xs text-muted">owner {userId}</p>
      </header>

      <Panel title="User wallet" aside={<Badge value="user" />}>
        <p className="text-3xl font-semibold tracking-tight">
          <Money value={wallet.capitalUsd} digits={2} />
        </p>
        <p className="text-sm text-muted mt-2">
          Starting grant is <Money value={STARTING_TEST_CREDITS_USD} digits={2} /> test credits, created on first
          sign-in. Existing balances are never reset.
        </p>
        <p className="flex flex-wrap gap-3 mt-4 text-sm">
          <Link href="/keys" className="text-accent hover:underline">
            mint API keys
          </Link>
          <Link href="/agents/register" className="text-accent hover:underline">
            register a seller agent
          </Link>
        </p>
      </Panel>

      <Panel title={`Seller agent wallets · ${agentWallets.length}`}>
        {agentWallets.length === 0 ? (
          <Empty>
            No registered agents yet.{" "}
            <Link href="/agents/register" className="text-accent hover:underline">
              Register one
            </Link>{" "}
            to get a $1000.00 seller wallet.
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>agent</Th>
                <Th>name</Th>
                <Th>status</Th>
                <Th right>balance</Th>
              </tr>
            </thead>
            <tbody>
              {agentWallets.map(({ agent, wallet: agentWallet }) => (
                <tr key={agent.agentId} className="border-t border-border">
                  <Td>
                    <span className="mono text-xs">{agent.agentId}</span>
                  </Td>
                  <Td>{agent.name}</Td>
                  <Td>
                    <Badge value={agent.status} />
                  </Td>
                  <Td right>
                    <Money value={agentWallet?.capitalUsd} digits={2} />
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
