import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { env } from "@/lib/env";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <nav className="border-b border-border bg-panel/60 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <Link href="/console" className="font-semibold tracking-tight">
              underwrite<span className="text-muted">/console</span>
            </Link>
            <Link href="/" className="text-muted hover:text-foreground">
              home
            </Link>
            <Link href="/api/v1/requests" className="text-muted hover:text-foreground mono text-xs">
              /api/v1/requests
            </Link>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="mono">debug ui · buyer is an agent</span>
            {env.clerk.enabled ? <UserButton /> : <span className="mono rounded bg-border px-1.5 py-0.5">clerk off</span>}
          </div>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-6xl px-6 py-8 flex-1">{children}</div>
    </div>
  );
}
