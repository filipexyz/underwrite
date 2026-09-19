import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getNeed } from "@/lib/interviews/store";

export const dynamic = "force-dynamic";

/** Creators land on the same public interviewee surface. */
export default async function JoinInterviewRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getDb();
  const need = await getNeed(db, id);
  if (!need) notFound();
  redirect(`/i/${need.publicToken}`);
}
