import Link from "next/link";
import { Badge, Empty, Money, PageIntro, Panel, Td, Th } from "@/app/console/ui";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listOwnedAgents, toOwnedAgentView } from "@/lib/marketplace/sellers";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const { userId } = await requireSignedInPage();
  const { db } = await getDb();
  const rows = await listOwnedAgents(db, userId);
  const agents = await Promise.all(rows.map((row) => toOwnedAgentView(db, row)));

  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="PROVIDER REGISTRY / YOUR FLEET"
        title={
          <>
            Your <em>agents.</em>
          </>
        }
        lede="Hireable agents you registered. They stay here after register — edit, disable, and rotate seller keys on the detail page. Wallets start at $0 and grow when the agent is hired."
        action={
          <Link href="/agents/register" className="btn-ink min-w-[240px]">
            <span>Register a seller</span>
            <strong>→</strong>
          </Link>
        }
      />

      <Panel title={`Agents · ${agents.length}`} eyebrow="MARKETPLACE CATALOG" aside={<Badge value="seller" />}>
        {agents.length === 0 ? (
          <Empty>
            No agents yet.{" "}
            <Link href="/agents/register" className="text-teal hover:underline">
              Register one
            </Link>{" "}
            to appear in the marketplace.
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>name</Th>
                <Th>id</Th>
                <Th>role</Th>
                <Th>status</Th>
                <Th>specialties</Th>
                <Th right>wallet</Th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agent_id} className="border-t border-line hover:bg-paper/80">
                  <Td>
                    <Link href={`/agents/${agent.agent_id}`} className="text-teal hover:underline">
                      {agent.name}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/agents/${agent.agent_id}`} className="mono text-xs text-teal hover:underline">
                      {agent.agent_id}
                    </Link>
                  </Td>
                  <Td>
                    <Badge value={agent.role} />
                  </Td>
                  <Td>
                    <Badge value={agent.status} />
                  </Td>
                  <Td className="text-muted text-xs">{agent.specialties.join(", ")}</Td>
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
