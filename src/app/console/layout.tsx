import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireSignedInPage } from "@/lib/auth/session";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await requireSignedInPage();
  return (
    <AppShell section="console" hint="debug ui · buyer is an agent">
      {children}
    </AppShell>
  );
}
