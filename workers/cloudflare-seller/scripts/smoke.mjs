#!/usr/bin/env node
/**
 * Hit local `wrangler dev` with signed fixtures that match
 * `src/lib/marketplace/push.ts` webhook bodies.
 *
 *   pnpm --dir workers/cloudflare-seller dev     # terminal A
 *   pnpm --dir workers/cloudflare-seller smoke   # terminal B
 *
 * Expects HTTP 202 (startFiber durable accept). The fiber then calls
 * NeuraLake + Underwrite if those secrets are real.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.SMOKE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const secret = process.env.UNDERWRITE_WEBHOOK_SECRET || "underwrite-webhook-stub";
const agentId = process.env.SMOKE_AGENT_ID || "agt_smoke";

const fixtures = ["plan_request.json", "accepted.json", "rejected.json"];

async function postFixture(name) {
  const body = readFileSync(join(root, "fixtures", name), "utf8").replace(/\s+$/, "");
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const res = await fetch(`${base}/webhook/${encodeURIComponent(agentId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-underwrite-signature": `sha256=${signature}`,
      "x-underwrite-timestamp": timestamp,
      "x-underwrite-agent-id": agentId,
    },
    body,
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep */
  }
  return { name, status: res.status, body: parsed };
}

const health = await fetch(`${base}/health`);
if (!health.ok) {
  console.error(`health check failed: ${health.status} — is wrangler dev running on ${base}?`);
  process.exit(1);
}
console.log("GET /health", await health.json());

const unsigned = await fetch(`${base}/webhook/${encodeURIComponent(agentId)}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: readFileSync(join(root, "fixtures", "plan_request.json"), "utf8"),
});
if (unsigned.status !== 401) {
  console.error(`expected 401 without HMAC, got ${unsigned.status}`);
  process.exit(1);
}
console.log("POST /webhook/:agentId without signature → 401 (ok)");

let failed = false;
for (const name of fixtures) {
  const result = await postFixture(name);
  const ok = result.status === 202 && result.body && result.body.ok === true;
  console.log(`POST /webhook/${agentId} ${name} → ${result.status}`, result.body);
  if (!ok) failed = true;
}

if (failed) {
  console.error("smoke failed");
  process.exit(1);
}
console.log("smoke passed — webhooks accepted (fibers started)");
