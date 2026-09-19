import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getNeed } from "@/lib/interviews/store";
import { SetupBanner } from "../../setup-banner";
import { InterviewRoom } from "./interview-room";

export const dynamic = "force-dynamic";

export default async function JoinInterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getDb();
  const need = await getNeed(db, id);
  if (!need) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={`/interviews/${need.id}`} className="text-xs text-muted hover:text-foreground">
          ← {need.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Join interview</h1>
        <p className="text-sm text-muted">{need.brief.goal}</p>
      </header>
      <SetupBanner />
      {env.agora.enabled ? (
        <InterviewRoom
          needId={need.id}
          title={need.title}
          questions={need.brief.questions}
          requiredFields={need.brief.required_fields}
          appId={env.agora.appId ?? ""}
        />
      ) : (
        <p className="text-sm text-muted">Configure Agora keys to join a live channel. Needs can still be registered.</p>
      )}
    </div>
  );
}
