import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getNeedByToken } from "@/lib/interviews/store";
import { InterviewRoom } from "@/app/interviews/[id]/join/interview-room";

export const dynamic = "force-dynamic";

export default async function PublicInterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { db } = await getDb();
  const need = await getNeedByToken(db, token);
  if (!need) notFound();

  const finished = need.status === "completed" || need.status === "cancelled";

  return (
    <main className="min-h-full flex flex-col items-center px-6 py-16">
      <div className="w-full max-w-lg flex flex-col gap-8">
        <header className="flex flex-col gap-2 text-center">
          <p className="mono text-xs text-accent tracking-widest uppercase">interview</p>
          <h1 className="text-3xl font-semibold tracking-tight">{need.title}</h1>
        </header>

        {finished ? (
          <section className="rounded-lg border border-border bg-panel p-8 flex flex-col gap-3 text-center">
            <p className="text-xs uppercase tracking-wider text-accent">done</p>
            <h2 className="text-xl font-semibold">This interview is already finished</h2>
            <p className="text-sm text-muted">You can close this tab.</p>
          </section>
        ) : env.agora.enabled ? (
          <InterviewRoom
            title={need.title}
            startPath={`/api/v1/interviews/i/${token}/start`}
            finalizePath={`/api/v1/interviews/i/${token}/finalize`}
            appId={env.agora.appId ?? ""}
            requiredFields={need.brief.required_fields}
            variant="public"
          />
        ) : (
          <section className="rounded-lg border border-border bg-panel p-6 text-sm text-muted text-center">
            This interview isn&apos;t ready yet. Ask the person who sent the link.
          </section>
        )}
      </div>
    </main>
  );
}
