import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Brand } from "@/components/site-chrome";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getNeedByToken } from "@/lib/interviews/store";
import { CallPreview } from "./call-preview";
import { InterviewRoom } from "./interview-room";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { db } = await getDb();
  const need = await getNeedByToken(db, token);
  if (!need) return { title: "Interview" };
  return { title: need.title, description: "Live voice interview. The interviewer ends the call when everything is answered." };
}

export default async function PublicInterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ui?: string }>;
}) {
  const { token } = await params;
  const { ui } = await searchParams;
  const { db } = await getDb();
  const need = await getNeedByToken(db, token);
  if (!need) notFound();

  const finished = need.status === "completed" || need.status === "cancelled";
  const preview = env.nodeEnv !== "production" && ui ? ui : null;

  return (
    <main className="min-h-full flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg flex flex-col gap-8">
        <Brand />
        <header className="flex flex-col gap-2">
          <p className="eyebrow">voice call / public token</p>
          <h1 className="page-title !text-[36px]">{need.title}</h1>
        </header>

        {preview ? (
          <CallPreview ui={preview} />
        ) : finished ? (
          <section className="certificate text-center">
            <p className="eyebrow !mb-2 !text-ink">call ended</p>
            <h2 className="font-sans text-xl font-semibold">This interview is already finished</h2>
            <p className="font-sans text-sm text-ink/70 mt-2">You can close this tab.</p>
          </section>
        ) : env.agora.enabled ? (
          <InterviewRoom
            startPath={`/api/v1/interviews/i/${token}/start`}
            finalizePath={`/api/v1/interviews/i/${token}/finalize`}
            appId={env.agora.appId ?? ""}
            requiredFields={need.brief.required_fields}
          />
        ) : (
          <section className="border border-ink bg-panel p-6 text-sm text-[#53605a] text-center">
            This interview isn&apos;t ready yet. Ask the person who sent the link.
          </section>
        )}
      </div>
    </main>
  );
}
