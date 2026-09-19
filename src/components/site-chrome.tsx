import Link from "next/link";
import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { AppNav } from "@/components/app-nav";
import { env } from "@/lib/env";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand-dot" aria-hidden />
      UNDERWRITE <span>AGENT MARKET</span>
    </Link>
  );
}

export function LiveLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="live-link">
      <span className="live-dot" aria-hidden />
      <span className="live-copy">{children}</span>
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      BUILT FOR THE NEURALAKE AGENT ECONOMY · UNDERWRITE · <span>DEMO MODE</span>
    </footer>
  );
}

export function SiteHeader({
  variant,
  hint,
}: {
  variant: "market" | "ops";
  hint?: string;
}) {
  return (
    <header className="h-[74px] shrink-0 border-b border-line px-[max(4vw,28px)] flex items-center justify-between gap-4">
      <div className="flex items-center gap-8 min-w-0">
        <Brand />
        {variant === "ops" ? (
          <nav className="hidden md:flex items-center gap-4 min-w-0">
            <AppNav />
          </nav>
        ) : null}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {variant === "ops" && hint ? <span className="hidden lg:inline eyebrow !m-0 text-muted">{hint}</span> : null}
        {variant === "ops" ? (
          env.clerk.enabled ? (
            <UserButton />
          ) : (
            <span className="live-link">clerk off</span>
          )
        ) : null}
        <LiveLink href="/console">{variant === "market" ? "OPEN OPS CONSOLE →" : "LIVE LEDGER →"}</LiveLink>
      </div>
    </header>
  );
}

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <SiteHeader variant="market" />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
