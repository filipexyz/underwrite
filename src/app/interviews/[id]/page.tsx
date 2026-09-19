import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty, PageIntro, Panel, Td, Th } from "@/app/console/ui";
import { getDb } from "@/lib/db/client";
import { getNeedDetail } from "@/lib/interviews/store";
import { CopyInvite } from "../copy-invite";
import { SetupBanner } from "../setup-banner";

export const dynamic = "force-dynamic";

export default async function InterviewNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getDb();
  const detail = await getNeedDetail(db, id);
  if (!detail) notFound();
  const { need, sessions } = detail;
  const invitePath = `/i/${need.publicToken}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/interviews" className="eyebrow inline-block hover:text-ink">
          ← pool
        </Link>
        <PageIntro
          eyebrow="NEED / INTERVIEWEE LINK"
          title={
            <>
              {need.title}
            </>
          }
          lede={<span className="mono text-xs">{need.id}</span>}
          action={<Badge value={need.status} />}
        />
      </div>

      <SetupBanner />

      <Panel title="Interviewee link" eyebrow="PUBLIC TOKEN">
        <p className="text-sm text-[#53605a] mb-3 leading-relaxed">
          Send this link. The human only sees a mic + the agent — no console, no Clerk. Possession of the token is auth.
          After the need is completed the link is spent.
        </p>
        <CopyInvite path={invitePath} />
      </Panel>

      <Panel title="Brief" eyebrow="QUESTIONS + FIELDS">
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div className="md:col-span-2">
            <dt className="eyebrow">Goal</dt>
            <dd>{need.brief.goal}</dd>
          </div>
          <div>
            <dt className="eyebrow">Questions</dt>
            <dd>
              <ol className="list-decimal pl-5 flex flex-col gap-1">
                {need.brief.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Required fields</dt>
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
              <dt className="eyebrow">Context</dt>
              <dd className="text-muted">{need.brief.context}</dd>
            </div>
          ) : null}
          {need.brief.success_criteria ? (
            <div className="md:col-span-2">
              <dt className="eyebrow">Success criteria</dt>
              <dd className="text-muted">{need.brief.success_criteria}</dd>
            </div>
          ) : null}
        </dl>
      </Panel>

      <Panel title="Result" eyebrow="STRUCTURED ANSWERS">
        {need.resultJson ? (
          <pre className="text-xs leading-relaxed overflow-x-auto bg-[#d8dfd8] p-3.5 font-mono">{JSON.stringify(need.resultJson, null, 2)}</pre>
        ) : (
          <Empty>No answers yet. Share the interviewee link; results land here after the interviewer ends the call.</Empty>
        )}
      </Panel>

      <Panel title={`${sessions.length} session${sessions.length === 1 ? "" : "s"}`} eyebrow="VOICE SESSIONS">
        {sessions.length === 0 ? (
          <Empty>No sessions yet. They appear after someone opens the interviewee link.</Empty>
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
                <tr key={session.id} className="border-t border-line">
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
