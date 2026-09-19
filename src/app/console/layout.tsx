import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell section="console" hint="debug ui · buyer is an agent">
      {children}
    </AppShell>
  );
}
