import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { resolveSessionIdentity } from "@/lib/auth/session";

export async function AppShell({
  section,
  hint,
  children,
}: {
  section: string;
  hint: string;
  children: ReactNode;
}) {
  // Admin-only links are hidden from the nav for everyone else. Enforced again on the pages and in
  // the server actions — this is courtesy, not the boundary.
  const identity = await resolveSessionIdentity();
  const admin = identity?.admin === true;
  return (
    <div className="min-h-full flex flex-col">
      <SiteHeader variant="ops" hint={`${section} · ${hint}`} />
      <nav className="md:hidden border-b border-line px-[max(4vw,28px)] py-3 flex flex-wrap gap-3">
        <AppNav admin={admin} />
      </nav>
      <div className="mx-auto w-full max-w-[1280px] px-[max(4vw,28px)] py-10 flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
