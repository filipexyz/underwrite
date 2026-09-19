import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireSignedInPage } from "@/lib/auth/session";

export default async function InterviewsLayout({ children }: { children: ReactNode }) {
  await requireSignedInPage();
  return (
    <AppShell section="interviews" hint="internal pool · agora gpt live">
      {children}
    </AppShell>
  );
}
