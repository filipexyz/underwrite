import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty, Panel, Td, Th } from "@/app/console/ui";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getNeedDetail } from "@/lib/interviews/store";
import { SetupBanner } from "../setup-banner";

export const dynamic = "force-dynamic";

export default async function InterviewNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getDb();
  const detail = await getNeedDetail(db, id);
  if (!detail) notFound();
  const { need, sessions } = detail;
  const canJoin = need.status === "open" || need.status === "in_progress";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/interviews" className="text-xs text-muted hover:text-foreground">
          ← pool
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{need.title}</h1>
          <Badge value={need.status} />
        </div>
        <p className="mono text-xs text-muted">{need.id}</p>
      </header>

      <SetupBanner />

      <div className="flex flex-wrap items-center gap-3">
        {canJoin && env.agora.enabled ? (
          <Link
            href={`/interviews/${need.id}/join`}
            className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Join interview
          </Link>
        ) : canJoin ? (
          <span className="rounded-md border border-border px-4 py-2 text-sm text-muted">Join interview (Agora not configured)</span>
        ) : null}
      </div>

      <Panel title="Brief">
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div className="md:col-span-2">
            <dt className="text-xs uppercase tracking-wider text-muted">Goal</dt>
            <dd>{need.brief.goal}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Questions</dt>
            <dd>
              <ol className="list-decimal pl-5 flex flex-col gap-1">
                {need.brief.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Required fields</dt>
            <dd>
              <ul className="mono text-xs flex flex-col gap-1">
                {need.brief.required_fields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </dd>
          </div>
          {need.brief.context ? (
            <div className="md:col-span-2">
              <dt className="text-xs uppercase tracking-wider text-muted">Context</dt>
              <dd className="text-muted">{need.brief.context}</dd>
            </div>
          ) : null}
          {need.brief.success_criteria ? (
            <div className="md:col-span-2">
              <dt className="text-xs uppercase tracking-wider text-muted">Success criteria</dt>
              <dd className="text-muted">{need.brief.success_criteria}</dd>
            </div>
          ) : null}
        </dl>
      </Panel>

      <Panel title="Result">
        {need.resultJson ? (
          <pre className="text-xs leading-relaxed overflow-x-auto rounded bg-background p-3 border border-border">
            {JSON.stringify(need.resultJson, null, 2)}
          </pre>
        ) : (
          <Empty>No answers yet. Join an interview and finalize the session.</Empty>
        )}
      </Panel>

      <Panel title={`${sessions.length} session${sessions.length === 1 ? "" : "s"}`}>
        {sessions.length === 0 ? (
          <Empty>No sessions. Join the interview to start GPT Live.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>session</Th>
                <Th>status</Th>
                <Th>channel</Th>
                <Th>agent</Th>
                <Th right>started</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-t border-border">
                  <Td className="mono text-xs">{session.id}</Td>
                  <Td>
                    <Badge value={session.status} />
                  </Td>
                  <Td className="mono text-xs text-muted">{session.agoraChannel}</Td>
                  <Td className="mono text-xs text-muted">{session.agoraAgentId ?? "—"}</Td>
                  <Td right>
                    <span className="mono text-xs text-muted">{new Date(session.startedAt).toLocaleString()}</span>
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
