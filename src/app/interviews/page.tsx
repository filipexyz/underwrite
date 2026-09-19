import Link from "next/link";
import { Badge, Empty, Panel, Td, Th } from "@/app/console/ui";
import { getDb } from "@/lib/db/client";
import { listNeeds } from "@/lib/interviews/store";
import { CreateNeedForm } from "./create-need-form";
import { SetupBanner } from "./setup-banner";

export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  const { db } = await getDb();
  const rows = await listNeeds(db);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Interview pool</h1>
        <p className="text-sm text-muted max-w-2xl">
          Register a need that requires a human. A GPT Live voice agent interviews them over Agora and writes structured
          answers back into Underwrite — later used as marketplace context, research, or onboarding.
        </p>
      </header>

      <SetupBanner />

      <Panel title="Register a need">
        <CreateNeedForm />
      </Panel>

      <Panel title={`${rows.length} need${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty>Nothing yet. Register a brief above.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>need</Th>
                <Th>status</Th>
                <Th>title</Th>
                <Th>goal</Th>
                <Th right>created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-background/40">
                  <Td>
                    <Link href={`/interviews/${row.id}`} className="mono text-xs text-accent hover:underline">
                      {row.id}
                    </Link>
                  </Td>
                  <Td>
                    <Badge value={row.status} />
                  </Td>
                  <Td>{row.title}</Td>
                  <Td className="max-w-md truncate text-muted">{row.brief.goal}</Td>
                  <Td right>
                    <span className="mono text-xs text-muted">{new Date(row.createdAt).toLocaleString()}</span>
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
