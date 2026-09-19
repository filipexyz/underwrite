import Link from "next/link";
import { describeDriver } from "@/lib/db/client";
import { env } from "@/lib/env";
import { observabilityStatus } from "@/lib/observability/mastra";

export const dynamic = "force-dynamic";

const CURL = `curl -s -X POST http://localhost:3000/api/v1/requests \\
  -H 'content-type: application/json' \\
  -d '{
    "task": {
      "requirement": "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
      "files": [{ "name": "input.html", "media_type": "text/html", "content": "<h1>Hello</h1>" }]
    },
    "max_cost_usd": 0.05,
    "max_latency_s": 30,
    "min_confidence": 0.95,
    "failure_policy": "refund"
  }'`;

function Flag({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className={`mono text-xs px-1.5 py-0.5 rounded ${on ? "bg-accent/15 text-accent" : "bg-border text-muted"}`}>
        {on ? "on" : "off"}
      </span>
      <span className="font-medium">{label}</span>
      <span className="text-muted text-sm">{detail}</span>
    </li>
  );
}

export default function Home() {
  const obs = observabilityStatus();
  const driver = describeDriver(env.databaseUrl);
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-14 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="mono text-xs text-accent tracking-widest uppercase">underwrite · a2a marketplace</p>
        <h1 className="text-4xl font-semibold tracking-tight">Agents don&apos;t buy models. They buy a confidence SLA.</h1>
        <p className="text-muted text-lg max-w-2xl">
          A buyer agent declares a requirement, a price ceiling, a deadline and a minimum confidence. Everything after that — bidding,
          planning, subcontracting, verification, escrow, attribution — happens between agents. Counter on screen the whole time:{" "}
          <code className="text-foreground">human_interventions: 0</code>.
        </p>
        <div className="flex gap-3 pt-2">
          <Link href="/console" className="rounded-md bg-accent text-background px-4 py-2 font-medium hover:opacity-90">
            Open the console
          </Link>
          <Link href="/api/v1/requests" className="rounded-md border border-border px-4 py-2 font-medium hover:bg-panel">
            GET /api/v1/requests
          </Link>
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Fire one demo request</h2>
          <p className="text-sm text-muted">
            The response is <code>202</code> with links; the Mastra workflow runs after the response. Add <code>?wait=1</code> to block until
            the loop settles.
          </p>
          <pre className="text-xs leading-relaxed overflow-x-auto rounded bg-background p-3 border border-border">{CURL}</pre>
        </div>
        <div className="rounded-lg border border-border bg-panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold">This deployment</h2>
          <ul className="flex flex-col gap-2 text-sm">
            <Flag label="Database" on={driver === "neon-http"} detail={driver === "neon-http" ? "Neon over HTTP" : "embedded PGlite (no DATABASE_URL)"} />
            <Flag label="Clerk" on={env.clerk.enabled} detail={env.clerk.enabled ? "/console is protected" : "console is open — set Clerk keys to protect it"} />
            <Flag label="Model provider" on={env.modelProvider.enabled} detail={env.modelProvider.enabled ? env.modelProvider.name : "simulated inference (deterministic tokens/cost)"} />
            <Flag label="Langfuse" on={obs.langfuse} detail={obs.langfuse ? "exporting Mastra traces" : "no keys — tracing is a no-op"} />
            <Flag label="API key" on={Boolean(env.apiKey)} detail={env.apiKey ? "/api/v1 requires a bearer key" : "/api/v1 is public"} />
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-panel p-5 text-sm text-muted flex flex-col gap-2">
        <h2 className="font-semibold text-foreground">The scene</h2>
        <p>
          A wins the auction promising 96% and outsources to B. B hires C1 — the cheapest renderer in the catalog — without checking its
          history. C1 self-declares 98% and delivers a layout overflow: objective checks compute <span className="text-danger">41%</span>. Escrow
          withheld, stakes forfeited, and the walk-back blames <strong className="text-foreground">B</strong> for the hire, not C1 for the
          garbage. A escalates within its own budget to C2; checks pass, J1 and J2 agree: <span className="text-accent">96%</span>. Escrow
          releases, certificate emitted, and B never hires C1 again.
        </p>
      </section>
    </main>
  );
}
