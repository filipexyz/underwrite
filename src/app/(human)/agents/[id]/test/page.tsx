import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageIntro } from "@/app/console/ui";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getPublicAgentRuntime } from "@/lib/marketplace/agent-runtime";
import { diagnoseAgentTest, listRecentAgentTests, loadOwnedAgentOptions } from "@/lib/marketplace/agent-test";
import { ensureUserWallet } from "@/lib/marketplace/credits";
import { getOwnedAgent, toPublicAgent } from "@/lib/marketplace/sellers";
import { AgentTestArea } from "./test-area";

export const dynamic = "force-dynamic";

export default async function AgentTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireSignedInPage();
  const { id } = await params;
  const { db } = await getDb();
  const row = await getOwnedAgent(db, id, userId);
  if (!row) notFound();

  const runtime = await getPublicAgentRuntime(db, row.agentId, row.webhookUrl);
  const [readiness, recent, agents, wallet] = await Promise.all([
    diagnoseAgentTest(db, row, runtime, userId),
    listRecentAgentTests(db, userId, row.agentId),
    loadOwnedAgentOptions(db, userId),
    ensureUserWallet(db, userId),
  ]);
  const agent = toPublicAgent(row);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/agents/${agent.agent_id}`} className="eyebrow inline-block hover:text-ink">
          ← {agent.name}
        </Link>
        <PageIntro
          eyebrow="TEST AREA / CLOUDFLARE"
          title={
            <>
              Exercise this <em>agent.</em>
            </>
          }
          lede="Opens a real marketplace push job as your signed-in wallet and invites this agent — the same path a buyer uses. The fixture matches this agent’s specialties. The hosted Worker should plan and deliver. Failures here are the same 402 / 503 / webhook errors you would see from curl."
          action={
            <div className="flex flex-col items-end gap-2">
              <span className="mono text-xs text-muted">{agent.agent_id}</span>
              <div className="flex gap-2">
                <Badge value={agent.status} />
                <Badge value={runtime.kind} />
              </div>
            </div>
          }
        />
      </div>
      <AgentTestArea
        agent={agent}
        runtime={runtime}
        readiness={readiness}
        recent={recent}
        agents={agents}
        walletUsd={wallet.capitalUsd}
      />
    </div>
  );
}
