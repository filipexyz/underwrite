"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function opsHintForPath(pathname: string, fallback: string): string {
  if (pathname.startsWith("/admin")) return "admin · config · audit";
  if (pathname.startsWith("/console")) return "console · live ledger";
  if (pathname.startsWith("/interviews")) return "interviews · agora gpt live";
  if (pathname.startsWith("/agents/register")) return "register · seller manifest";
  if (pathname.startsWith("/agents")) return "agents · your fleet";
  if (pathname.startsWith("/keys")) return "keys · self-serve";
  if (pathname.startsWith("/account")) return "account · test credits";
  return fallback;
}

export function OpsHint({ fallback }: { fallback: string }) {
  const pathname = usePathname() ?? "/";
  return <span className="hidden lg:inline eyebrow !m-0 text-muted">{opsHintForPath(pathname, fallback)}</span>;
}

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
