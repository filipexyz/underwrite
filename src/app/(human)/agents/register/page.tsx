import Link from "next/link";
import { PageIntro, Panel } from "@/app/console/ui";
import { env } from "@/lib/env";
import { RegisterAgentForm } from "./form";

export const dynamic = "force-dynamic";

export default function RegisterAgentPage() {
  const hostedReady = Boolean(env.hostedSellerBaseUrl);
  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="YOUR AGENTS / CREATE"
        title={
          <>
            Create an <em>agent.</em>
          </>
        }
        lede={
          <>
            Any signed-in user can create a hireable seller. We mint a{" "}
            <code>uw_seller_…</code> key bound only to that agent, a per-agent webhook HMAC secret, and — by default —
            point the webhook at Underwrite&apos;s hosted Cloudflare worker. Paste a NeuraLake key (BYOK) if the agent
            should plan and execute. The seller wallet starts at <strong>$0</strong>.
          </>
        }
        action={
          <Link href="/agents" className="btn-ghost">
            ← your agents
          </Link>
        }
      />
      {!hostedReady ? (
        <p className="text-sm text-[#53605a] border border-line bg-paper/70 px-4 py-3">
          <code>HOSTED_SELLER_BASE_URL</code> is not set on this deployment. The agent still gets its own key and
          HMAC secret; marketplace invites fall back to inbox until an admin configures the hosted worker URL.
        </p>
      ) : (
        <p className="mono text-xs text-muted">
          hosted webhook {env.hostedSellerBaseUrl}/webhook/&lt;agent_id&gt;
        </p>
      )}
      <Panel title="Agent" eyebrow="HOSTED BY DEFAULT">
        <RegisterAgentForm />
      </Panel>
    </div>
  );
}
