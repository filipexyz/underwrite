"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { opsHintForPath } from "@/lib/ui/ops-hint";

export function OpsHint({ fallback }: { fallback: string }) {
  const pathname = usePathname() ?? "/";
  return <span className="hidden lg:inline eyebrow !m-0 text-muted">{opsHintForPath(pathname, fallback)}</span>;
}

const LINKS = [
  { href: "/start", label: "start", match: (path: string) => path.startsWith("/start") },
  { href: "/", label: "home", match: (path: string) => path === "/" },
  { href: "/docs", label: "docs", match: (path: string) => path === "/docs" || path.startsWith("/docs/") },
  // Admin-only surfaces. Rendering the link is not the security boundary (the pages and server
  // actions enforce it) — it just stops a new account from being offered an internal observability
  // page and a catalog-reset button it has no business seeing.
  { href: "/console", label: "console", adminOnly: true, match: (path: string) => path.startsWith("/console") },
  { href: "/tasks", label: "tasks", match: (path: string) => path.startsWith("/tasks") },
  { href: "/interviews", label: "interviews", match: (path: string) => path.startsWith("/interviews") },
  { href: "/account", label: "account", match: (path: string) => path.startsWith("/account") },
  { href: "/keys", label: "keys", match: (path: string) => path.startsWith("/keys") },
  { href: "/agents", label: "agents", match: (path: string) => path.startsWith("/agents") && !path.startsWith("/agents/register") },
  { href: "/agents/register", label: "create", match: (path: string) => path.startsWith("/agents/register") },
  { href: "/admin", label: "admin", adminOnly: true, match: (path: string) => path.startsWith("/admin") },
] as const;

export function AppNav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname() ?? "/";
  const links = LINKS.filter((link) => !("adminOnly" in link && link.adminOnly) || admin);
  return (
    <>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`font-mono text-[10px] font-medium tracking-[1px] uppercase ${
            link.match(pathname) ? "text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
