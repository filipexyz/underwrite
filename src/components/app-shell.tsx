import type { ReactNode } from "react";
import { ClerkGate } from "@/app/clerk-gate";
import { AppNav } from "@/components/app-nav";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

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
        <SiteHeader variant="ops" hint={`${section} · ${hint}`} />
        <nav className="md:hidden border-b border-line px-[max(4vw,28px)] py-3 flex flex-wrap gap-3">
          <AppNav />
        </nav>
        <div className="mx-auto w-full max-w-[1280px] px-[max(4vw,28px)] py-10 flex-1">{children}</div>
        <SiteFooter />
      </div>
    </ClerkGate>
  );
}
