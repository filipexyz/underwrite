import type { ReactNode } from "react";

const STATUS_STYLE: Record<string, string> = {
  received: "border-line text-ink",
  auctioning: "border-[#d6823e] text-warn",
  contracting: "border-[#d6823e] text-warn",
  executing: "border-[#d6823e] text-warn",
  verifying: "border-[#d6823e] text-warn",
  escalated: "border-[#d4a090] text-danger",
  completed: "border-[#62ad9e] text-teal",
  failed: "border-[#d4a090] text-danger",
  no_eligible_bid: "border-[#d4a090] text-danger",
  LOCKED: "border-[#d6823e] text-warn",
  RELEASED: "border-[#62ad9e] text-teal bg-acid/50",
  WITHHELD: "border-[#d4a090] text-danger",
  ESCALATED: "border-[#d4a090] text-danger",
  REFUNDED: "border-line text-ink",
  DISPUTE: "border-[#d4a090] text-danger",
  CREATED: "border-line text-ink",
  generated: "border-line text-ink",
  validated: "border-[#62ad9e] text-teal",
  rejected: "border-[#d4a090] text-danger",
  pass: "border-[#62ad9e] text-teal",
  fail: "border-[#d4a090] text-danger",
  inconclusive: "border-[#d6823e] text-warn",
  seed: "border-line text-ink",
  registered: "border-[#62ad9e] text-teal",
  disabled: "border-[#d4a090] text-danger",
  buyer: "border-[#62ad9e] text-teal",
  seller: "border-[#d6823e] text-warn",
  admin_service: "border-line text-ink",
  revoked: "border-[#d4a090] text-danger",
  active: "border-[#62ad9e] text-teal",
  user: "border-[#62ad9e] text-teal",
  agent: "border-[#d6823e] text-warn",
  system: "border-line text-ink",
  open: "border-line text-ink",
  in_progress: "border-[#d6823e] text-warn",
  cancelled: "border-line text-muted",
  live: "border-[#d6823e] text-warn",
  listening: "border-[#62ad9e] text-teal",
  thinking: "border-[#d6823e] text-warn",
  speaking: "border-[#62ad9e] text-teal",
  selected: "border-[#62ad9e] text-teal bg-acid/40",
  "200": "border-[#62ad9e] text-teal",
  "202": "border-[#62ad9e] text-teal",
  "400": "border-[#d4a090] text-danger",
  "401": "border-[#d4a090] text-danger",
  "402": "border-[#d4a090] text-danger",
  "403": "border-[#d4a090] text-danger",
  "404": "border-[#d4a090] text-danger",
  "422": "border-[#d6823e] text-warn",
  calling: "border-[#d6823e] text-warn",
};

export const TERMINAL_STATUSES = new Set(["completed", "failed", "no_eligible_bid"]);

export const inputClass = "input-mesh";

export function Badge({ value }: { value: string }) {
  return (
    <span className={`mono inline-block text-[9px] tracking-[0.8px] uppercase border px-1.5 py-0.5 ${STATUS_STYLE[value] ?? "border-line"}`}>
      {value}
    </span>
  );
}

export function Money({ value, digits = 4 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return <span className="mono">${value.toFixed(digits)}</span>;
}

export function Pct({ value, tone }: { value: number | null | undefined; tone?: "good" | "bad" | "auto" }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const color =
    tone === "good" ? "text-teal" : tone === "bad" ? "text-danger" : tone === "auto" ? (value >= 0.95 ? "text-teal" : value < 0.7 ? "text-danger" : "text-warn") : "";
  return <span className={`mono ${color}`}>{(value * 100).toFixed(1)}%</span>;
}

export function Panel({
  title,
  children,
  aside,
  eyebrow,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <section className="border border-ink bg-panel">
      <header className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-line">
        <div>
          {eyebrow ? <p className="eyebrow !mb-1">{eyebrow}</p> : null}
          <h2 className="font-mono text-[10px] font-medium tracking-[1px] uppercase text-ink">{title}</h2>
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      <div className="p-5 overflow-x-auto">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#59635f] leading-relaxed">{children}</p>;
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th className={`font-mono text-[10px] font-medium text-muted uppercase tracking-[1px] py-2 ${right ? "text-right" : "text-left"} pr-3`}>
      {children}
    </th>
  );
}

export function Td({ children, right, className = "" }: { children: ReactNode; right?: boolean; className?: string }) {
  return <td className={`py-2 pr-3 align-top text-sm ${right ? "text-right" : ""} ${className}`}>{children}</td>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow !mb-1">{label}</dt>
      <dd className="pt-0.5">{value}</dd>
    </div>
  );
}

export function PageIntro({
  eyebrow,
  title,
  lede,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {lede ? <div className="mt-3 text-[15px] leading-relaxed text-[#53605a]">{lede}</div> : null}
      </div>
      {action ? <div className="shrink-0 flex flex-col items-stretch gap-2">{action}</div> : null}
    </header>
  );
}

export function PhaseRail({
  steps,
}: {
  steps: Array<{ n: string; title: string; sub: string; state: "waiting" | "active" | "passed" }>;
}) {
  return (
    <section className="phase-rail">
      {steps.map((step) => (
        <div key={step.n} className={step.state === "active" ? "is-active" : step.state === "waiting" ? "is-waiting" : ""}>
          <b>{step.n}</b>
          <span>{step.title}</span>
          <small>{step.sub}</small>
        </div>
      ))}
    </section>
  );
}

export function NetworkStrip({
  nodes,
}: {
  nodes: Array<{ label: string; note: string; kind: "consumer" | "market" | "providers" | "judge" | "escrow" }>;
}) {
  return (
    <section className="network-strip">
      {nodes.map((node, i) => (
        <span key={node.label} className="contents">
          {i > 0 ? <i aria-hidden /> : null}
          <div className={`network-node kind-${node.kind}`}>
            <b>{node.label}</b>
            <small>{node.note}</small>
          </div>
        </span>
      ))}
    </section>
  );
}
