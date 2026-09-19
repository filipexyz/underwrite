/**
 * `pnpm demo` — fires the demo request over HTTP, exactly like a buyer agent
 * would, then streams the ledger until the loop settles.
 *
 *   pnpm dev                                  # in another terminal
 *   pnpm demo                                 # → http://localhost:3000
 *   pnpm demo --base https://underwrite.vercel.app
 *   pnpm demo --wait                          # single blocking call (?wait=1), no polling
 *
 * The target server must have NeuraLake configured. Missing keys → HTTP 503.
 *
 * Honours `UNDERWRITE_BASE_URL` and `UNDERWRITE_API_KEY` from `.env.local`.
 * The server must have MODEL_PROVIDER_API_KEY (NeuraLake); otherwise POST is 503.
 */
import "./load-env";
import type { LedgerEvent } from "@/lib/contracts";
import { summarizeEvent } from "@/lib/ledger/summarize";
import { DEMO_REQUEST, type ApiRequest } from "@/lib/marketplace/requests";

const TERMINAL = new Set(["completed", "failed", "no_eligible_bid"]);
const POLL_MS = 400;
const TIMEOUT_MS = 5 * 60_000;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = (arg("--base") ?? process.env.UNDERWRITE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.UNDERWRITE_API_KEY) headers.authorization = `Bearer ${process.env.UNDERWRITE_API_KEY}`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function printEvent(e: LedgerEvent) {
  const tokens = e.tokens_in + e.tokens_out > 0 ? `${e.tokens_in}/${e.tokens_out}` : "";
  const cost = e.cost_usd > 0 ? `$${e.cost_usd.toFixed(6)}` : "";
  console.log(
    `${String(e.seq).padStart(3)}  ${e.type.padEnd(24)} ${(e.agent_id ?? "").padEnd(14)} ${tokens.padEnd(11)} ${cost.padEnd(11)} ${summarizeEvent(e)}`,
  );
}

type Feed = { status: string; events: LedgerEvent[] };
type Accepted = { request_id: string; status: string; links: { self: string; events: string; console: string } };

async function main() {
  console.log(`[demo] POST ${base}/api/v1/requests (max $${DEMO_REQUEST.max_cost_usd}, ≤ ${DEMO_REQUEST.max_latency_s}s, ≥ ${DEMO_REQUEST.min_confidence * 100}%)`);
  console.log("\nseq  type                     agent          tokens      cost        summary");

  let detail: ApiRequest;
  if (process.argv.includes("--wait")) {
    detail = await api<ApiRequest>("/api/v1/requests?wait=1", { method: "POST", body: JSON.stringify(DEMO_REQUEST) });
    for (const e of detail.events) printEvent(e);
  } else {
    const accepted = await api<Accepted>("/api/v1/requests", { method: "POST", body: JSON.stringify(DEMO_REQUEST) });
    console.error(`[demo] ${accepted.request_id} accepted → console: ${accepted.links.console}`);

    let after = 0;
    let status = accepted.status;
    const deadline = Date.now() + TIMEOUT_MS;
    while (!TERMINAL.has(status)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${accepted.request_id} (status=${status})`);
      await new Promise((r) => setTimeout(r, POLL_MS));
      const feed = await api<Feed>(`/api/v1/requests/${accepted.request_id}/events?after=${after}`);
      for (const e of feed.events) printEvent(e);
      if (feed.events.length > 0) after = feed.events.at(-1)?.seq ?? after;
      status = feed.status;
    }
    detail = await api<ApiRequest>(`/api/v1/requests/${accepted.request_id}`);
  }

  console.log(`\nstatus: ${detail.status}   human_interventions: ${detail.human_interventions}`);
  console.log(`metrics: ${JSON.stringify(detail.metrics)}`);
  const outcome = (detail.outcome ?? {}) as { certificate?: Record<string, unknown> };
  if (outcome.certificate) console.log(`certificate: ${JSON.stringify(outcome.certificate)}`);
  for (const a of detail.attributions) console.log(`attribution: ${a.root_cause} → ${a.blamed_agent}: ${a.explanation}`);
  process.exit(detail.status === "completed" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
