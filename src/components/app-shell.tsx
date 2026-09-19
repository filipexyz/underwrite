import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { env } from "@/lib/env";

const LINKS = [
  { href: "/", label: "home" },
  { href: "/console", label: "console" },
  { href: "/keys", label: "keys" },
  { href: "/agents/register", label: "register" },
  { href: "/admin", label: "admin" },
] as const;

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
    <div className="min-h-full flex flex-col">
      <nav className="border-b border-border bg-panel/60 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <Link href={sectionHref(section)} className="font-semibold tracking-tight">
              underwrite<span className="text-muted">/{section}</span>
            </Link>
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-muted hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="mono">{hint}</span>
            {env.clerk.enabled ? <UserButton /> : <span className="mono rounded bg-border px-1.5 py-0.5">clerk off</span>}
          </div>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-6xl px-6 py-8 flex-1">{children}</div>
    </div>
  );
}

function sectionHref(section: string): string {
  if (section === "console") return "/console";
  if (section === "admin") return "/admin";
  if (section === "register") return "/agents/register";
  return "/keys";
}
