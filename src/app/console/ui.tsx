import type { ReactNode } from "react";

const STATUS_STYLE: Record<string, string> = {
  received: "bg-border text-foreground",
  auctioning: "bg-warn/15 text-warn",
  contracting: "bg-warn/15 text-warn",
  executing: "bg-warn/15 text-warn",
  verifying: "bg-warn/15 text-warn",
  escalated: "bg-danger/15 text-danger",
  completed: "bg-accent/15 text-accent",
  failed: "bg-danger/15 text-danger",
  no_eligible_bid: "bg-danger/15 text-danger",
  LOCKED: "bg-warn/15 text-warn",
  RELEASED: "bg-accent/15 text-accent",
  WITHHELD: "bg-danger/15 text-danger",
  ESCALATED: "bg-danger/15 text-danger",
  REFUNDED: "bg-border text-foreground",
  DISPUTE: "bg-danger/15 text-danger",
  CREATED: "bg-border text-foreground",
  validated: "bg-accent/15 text-accent",
  rejected: "bg-danger/15 text-danger",
  pass: "bg-accent/15 text-accent",
  fail: "bg-danger/15 text-danger",
  inconclusive: "bg-warn/15 text-warn",
  seed: "bg-border text-foreground",
  registered: "bg-accent/15 text-accent",
  disabled: "bg-danger/15 text-danger",
  buyer: "bg-accent/15 text-accent",
  seller: "bg-warn/15 text-warn",
  admin_service: "bg-border text-foreground",
  revoked: "bg-danger/15 text-danger",
  active: "bg-accent/15 text-accent",
};

export const TERMINAL_STATUSES = new Set(["completed", "failed", "no_eligible_bid"]);

export function Badge({ value }: { value: string }) {
  return <span className={`mono inline-block text-xs px-1.5 py-0.5 rounded ${STATUS_STYLE[value] ?? "bg-border"}`}>{value}</span>;
}

export function Money({ value, digits = 4 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return <span className="mono">${value.toFixed(digits)}</span>;
}

export function Pct({ value, tone }: { value: number | null | undefined; tone?: "good" | "bad" | "auto" }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const color =
    tone === "good" ? "text-accent" : tone === "bad" ? "text-danger" : tone === "auto" ? (value >= 0.95 ? "text-accent" : value < 0.7 ? "text-danger" : "text-warn") : "";
  return <span className={`mono ${color}`}>{(value * 100).toFixed(1)}%</span>;
}

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-panel">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`text-xs font-medium text-muted uppercase tracking-wider py-1.5 ${right ? "text-right" : "text-left"} pr-3`}>{children}</th>;
}

export function Td({ children, right, className = "" }: { children: ReactNode; right?: boolean; className?: string }) {
  return <td className={`py-1.5 pr-3 align-top text-sm ${right ? "text-right" : ""} ${className}`}>{children}</td>;
}
