/**
 * `pnpm loop` — fires the demo request and runs the Mastra workflow
 * in-process (no HTTP server), then prints the ledger. Requires
 * MODEL_PROVIDER_API_KEY — there is no simulated inference. Works against Neon
 * (`DATABASE_URL`) or the local PGlite directory.
 *
 *   pnpm loop                  # demo request
 *   pnpm loop --reseed         # reset the catalog first (fresh axes / pairwise trust)
 */
import "./load-env";
import { getDb } from "@/lib/db/client";
import { seed } from "@/lib/db/seed";
import { createRequest, DEMO_REQUEST, getRequestDetail } from "@/lib/marketplace/requests";
import { summarizeEvent } from "@/lib/ledger/summarize";
import { requireModelProvider } from "@/lib/observability/inference";
import { runMarketplace } from "@/mastra";

function money(n: number): string {
  return `$${n.toFixed(6)}`;
}

async function main() {
  requireModelProvider();
  const { db, driver } = await getDb();
  if (process.argv.includes("--reseed")) await seed(db);
  console.log(`[loop] driver=${driver}`);

  const request = await createRequest(db, DEMO_REQUEST, { actor: "agent", source: "scripts/run-loop" });
  console.log(`[loop] request ${request.requestId} received`);

  const started = Date.now();
  const outcome = await runMarketplace(request.requestId);
  console.log(`[loop] workflow ${outcome.status} in ${Date.now() - started}ms`);

  const detail = await getRequestDetail(db, request.requestId);
  if (!detail) throw new Error("request vanished");

  console.log("\nseq  type                     agent          model            tokens      cost        payload");
  for (const e of detail.events) {
    const tokens = e.tokens_in + e.tokens_out > 0 ? `${e.tokens_in}/${e.tokens_out}` : "";
    const cost = e.cost_usd > 0 ? money(e.cost_usd) : "";
    const summary = summarizeEvent(e);
    console.log(
      `${String(e.seq).padStart(3)}  ${e.type.padEnd(24)} ${(e.agent_id ?? "").padEnd(14)} ${(e.model ?? "").padEnd(16)} ${tokens.padEnd(11)} ${cost.padEnd(11)} ${summary}`,
    );
  }

  console.log(`\nstatus: ${detail.request.status}`);
  console.log(`metrics: ${JSON.stringify(detail.metrics)}`);
  console.log(`outcome: ${JSON.stringify(detail.request.outcome, null, 2)}`);
  for (const a of detail.attributions) console.log(`attribution: ${a.rootCause} → ${a.blamedAgent}: ${a.explanation}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
