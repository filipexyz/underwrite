import { PageIntro, Panel } from "@/app/console/ui";
import { loadClaimAttemptByToken } from "@/lib/auth/auth-md";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppShell } from "@/components/app-shell";
import { ClaimForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ claim_attempt_token?: string }>;
}) {
  const identity = await requireSignedInPage();
  const { claim_attempt_token: token } = await searchParams;
  const { db } = await getDb();
  const loaded = token ? await loadClaimAttemptByToken(db, token) : null;

  return (
    <AppShell section="claim" hint="bind an agent to this Auth0 user">
      <PageIntro
        eyebrow="AUTH.MD / CLAIM CEREMONY"
        title={
          <>
            Confirm the <em>code.</em>
          </>
        }
        lede="An agent asked to act on your behalf. Type the 6-digit code it showed you. This binds its registration to your Underwrite wallet."
      />
      <p className="mono text-xs text-muted -mt-4 mb-6">signed in as {identity.email ?? identity.userId}</p>
      <Panel title="Verification" eyebrow="USER CODE">
        {!token ? (
          <p className="text-sm text-[#53605a]">
            Open the verification link the agent gave you. It includes a <code>claim_attempt_token</code>.
          </p>
        ) : !loaded ? (
          <p className="text-sm text-danger">This claim link is unknown. Ask the agent to start a new ceremony.</p>
        ) : loaded.registration.status === "claimed" ? (
          <p className="text-sm text-teal">Already claimed. The agent can exchange its assertion for a token.</p>
        ) : (
          <ClaimForm claimAttemptToken={token} />
        )}
      </Panel>
    </AppShell>
  );
}
