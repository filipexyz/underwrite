import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell section="docs" hint="agent api">
      {children}
    </AppShell>
  );
}
