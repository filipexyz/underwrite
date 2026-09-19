import { UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { ClerkGate } from "@/app/clerk-gate";
import { AppBrand, AppNav } from "@/components/app-nav";
import { env } from "@/lib/env";

export function AppShell({
  section,
  hint,
  children,
}: {
  section: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <ClerkGate>
      <div className="min-h-full flex flex-col">
        <nav className="border-b border-border bg-panel/60 backdrop-blur">
          <div className="mx-auto w-full max-w-6xl px-6 h-12 flex items-center justify-between">
            <div className="flex items-center gap-6 text-sm">
              <AppBrand fallback={section} />
              <AppNav />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="mono">{hint}</span>
              {env.clerk.enabled ? <UserButton /> : <span className="mono rounded bg-border px-1.5 py-0.5">clerk off</span>}
            </div>
          </div>
        </nav>
        <div className="mx-auto w-full max-w-6xl px-6 py-8 flex-1">{children}</div>
      </div>
    </ClerkGate>
  );
}
