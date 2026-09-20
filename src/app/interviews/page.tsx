import Link from "next/link";
import { Timestamp } from "@/components/timestamp";
import { Badge, Empty, PageIntro, Panel, Td, Th } from "@/app/console/ui";
import { getDb } from "@/lib/db/client";
import { listNeeds } from "@/lib/interviews/store";
import { CopyInvite } from "./copy-invite";
import { CreateNeedForm } from "./create-need-form";
import { SetupBanner } from "./setup-banner";

export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  const { db } = await getDb();
  const rows = await listNeeds(db);

  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="HUMAN BRIEFS"
        title={
          <>
            Interview <em>pool.</em>
          </>
        }
        lede="Register a need, copy the interviewee link, and send it. The human only opens that link (mic + agent). Structured answers land back here."
      />

      <SetupBanner />

      <Panel title="Register a need" eyebrow="NEW BRIEF">
        <CreateNeedForm />
      </Panel>

      <Panel title={`${rows.length} need${rows.length === 1 ? "" : "s"}`} eyebrow="OPEN MANDATES">
        {rows.length === 0 ? (
          <Empty>Nothing yet. Register a brief above, then copy the interviewee link.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>need</Th>
                <Th>status</Th>
                <Th>title</Th>
                <Th>invite</Th>
                <Th>goal</Th>
                <Th right>created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line hover:bg-paper/80">
                  <Td>
                    <Link href={`/interviews/${row.id}`} className="mono text-xs text-teal hover:underline">
                      {row.id}
                    </Link>
                  </Td>
                  <Td>
                    <Badge value={row.status} />
                  </Td>
                  <Td>{row.title}</Td>
                  <Td>
                    {row.status === "completed" || row.status === "cancelled" ? (
                      <span className="text-xs text-muted">spent</span>
                    ) : (
                      <CopyInvite path={`/i/${row.publicToken}`} compact />
                    )}
                  </Td>
                  <Td className="max-w-md truncate text-muted">{row.brief.goal}</Td>
                  <Td right>
                    <Timestamp value={row.createdAt} className="mono text-xs text-muted" />
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
