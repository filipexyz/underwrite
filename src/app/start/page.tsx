import Link from "next/link";
import { Timestamp } from "@/components/timestamp";
import { AppShell } from "@/components/app-shell";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { listVoiceSessions } from "@/lib/voice/store";
import { VoiceComposer } from "./voice-composer";
import { VoiceDiagnostics } from "./voice-diagnostics";

export const dynamic = "force-dynamic";

/**
 * `/start` — the signed-in landing, identical for every role.
 *
 * This is the app's initial screen once someone is authenticated: talk, and the agent turns the
 * conversation into a marketplace task. There is deliberately no role variation here — an admin lands
 * on the same page with the same composer, because the initial screen is not a control surface. The
 * ops console is reachable from the nav and is nobody's landing page.
 */
export default async function StartPage() {
  const identity = await requireSignedInPage();
  const { db } = await getDb();
  const recent = await listVoiceSessions(db, identity.userId, 5);

  return (
    <AppShell section="start" hint="talk · the agent files the task">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-3">
            <p className="eyebrow !mb-0">START / VOICE</p>
            <h1 className="page-title !text-[42px]">
              Say what you need. <em>Get a task.</em>
            </h1>
            <p className="font-sans text-sm text-[#53605a] max-w-xl leading-relaxed">
              Describe the work out loud. The agent asks for the price, the deadline and the confidence you require,
              tells you when those cannot all hold, then posts the task to the marketplace on your behalf — no form,
              no dashboard.
            </p>
          </header>

          {env.agora.enabled ? (
            <VoiceComposer startPath="/api/v1/voice/sessions" />
          ) : (
            <section className="border border-ink bg-panel p-6 text-sm text-[#53605a]">
              The voice composer is not configured on this deployment
              {env.agora.missing.length > 0 ? ` (missing: ${env.agora.missing.join(", ")})` : null}. See the README
              for the Agora environment variables.
            </section>
          )}

          <VoiceDiagnostics />
        </div>

        <aside className="flex flex-col gap-4">
          <h2 className="eyebrow !mb-0">Your recent conversations</h2>
          {recent.length === 0 ? (
            <p className="font-mono text-xs text-muted leading-relaxed">
              Nothing yet. Your first conversation will appear here with the task it produced.
            </p>
          ) : (
            <ul className="flex flex-col border border-line">
              {recent.map((row) => (
                <li key={row.id} className="border-b border-line last:border-b-0 px-3 py-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="mono text-[10px] uppercase tracking-wider text-muted">{row.status}</span>
                    <Timestamp value={row.startedAt} className="mono text-[10px] text-muted" />
                  </div>
                  <span className="text-xs leading-relaxed">
                    {row.briefJson?.requirement ?? row.error ?? "no task yet"}
                  </span>
                  {row.requestId ? (
                    <Link
                      href={`/console/requests/${row.requestId}`}
                      className="mono text-[10px] text-teal hover:underline"
                    >
                      {row.requestId}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
