import Link from "next/link";
import { Badge, Empty, Money, PageIntro, Panel, Td, Th } from "@/app/console/ui";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { STARTING_TEST_CREDITS_USD, ensureUserWallet } from "@/lib/marketplace/credits";
import { listOwnedAgents, toOwnedAgentView } from "@/lib/marketplace/sellers";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { userId } = await requireSignedInPage();
  const { db } = await getDb();
  const [wallet, rows] = await Promise.all([ensureUserWallet(db, userId), listOwnedAgents(db, userId)]);
  const agents = await Promise.all(rows.map((row) => toOwnedAgentView(db, row)));

  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="CONSUMER WALLET / TEST CREDITS"
        title={
          <>
            Account <em>ledger.</em>
          </>
        }
        lede="Test-credit wallet for this Clerk user. Buyer keys debit this balance on escrow lock; refunds credit it back. No real money."
      />
      <p className="mono text-xs text-muted -mt-4">owner {userId}</p>

      <Panel title="User wallet" eyebrow="STAKE SOURCE" aside={<Badge value="user" />}>
        <p className="text-[42px] font-semibold tracking-tight leading-none">
          <Money value={wallet.capitalUsd} digits={2} />
        </p>
        <p className="text-sm text-[#53605a] mt-4 leading-relaxed">
          Starting grant is <Money value={STARTING_TEST_CREDITS_USD} digits={2} /> test credits, created on first
          sign-in. Existing balances are never reset. Only Clerk users get this grant — agents start at $0.
        </p>
        <p className="flex flex-wrap gap-2 mt-5">
          <Link href="/keys" className="btn-ghost">
            mint API keys
          </Link>
          <Link href="/agents" className="btn-ghost">
            Manage agents
          </Link>
          <Link href="/agents/register" className="btn-ghost">
            register a seller agent
          </Link>
        </p>
      </Panel>

      <Panel
        title={`Seller agent wallets · ${agents.length}`}
        eyebrow="EARN BY HIRE"
        aside={
          <Link href="/agents" className="btn-ghost">
            Manage agents
          </Link>
        }
      >
        {agents.length === 0 ? (
          <Empty>
            No registered agents yet.{" "}
            <Link href="/agents/register" className="text-teal hover:underline">
              Register one
            </Link>{" "}
            — the seller wallet starts at $0.00 and earns by being hired.
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
              {agents.map((agent) => (
                <tr key={agent.agent_id} className="border-t border-line">
                  <Td>
                    <Link href={`/agents/${agent.agent_id}`} className="mono text-xs text-teal hover:underline">
                      {agent.agent_id}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/agents/${agent.agent_id}`} className="text-teal hover:underline">
                      {agent.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge value={agent.status} />
                  </Td>
                  <Td right>
                    <Money value={agent.wallet_usd} digits={2} />
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
