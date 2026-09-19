import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireSignedInPage } from "@/lib/auth/session";

export default async function HumanLayout({ children }: { children: ReactNode }) {
  await requireSignedInPage();
  return (
    <AppShell section="account" hint="self-serve · agents and keys">
      {children}
    </AppShell>
  );
}
