"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "home", match: (path: string) => path === "/" },
  { href: "/console", label: "console", match: (path: string) => path.startsWith("/console") },
  { href: "/interviews", label: "interviews", match: (path: string) => path.startsWith("/interviews") },
  { href: "/account", label: "account", match: (path: string) => path.startsWith("/account") },
  { href: "/keys", label: "keys", match: (path: string) => path.startsWith("/keys") },
  { href: "/agents", label: "agents", match: (path: string) => path.startsWith("/agents") && !path.startsWith("/agents/register") },
  { href: "/agents/register", label: "register", match: (path: string) => path.startsWith("/agents/register") },
  { href: "/admin", label: "admin", match: (path: string) => path.startsWith("/admin") },
] as const;

export function AppNav() {
  const pathname = usePathname() ?? "/";
  return (
    <>
      {LINKS.map((link) => (
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
