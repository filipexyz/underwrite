#!/usr/bin/env node
/**
 * Local seller stub for the locked marketplace PoC (no reprice).
 *
 * Env:
 *   SELLER_KEY              required — hashed seller key bound to your agent
 *   UNDERWRITE_BASE_URL     default http://localhost:3000
 *   WEBHOOK_PORT            if set, listen for POSTs (express-shaped HTTP)
 *   WEBHOOK_URL             public URL to PATCH onto the agent (webhook mode)
 *   POLL_MS                 inbox poll interval (default 1000)
 *   PRICE_USD / CONFIDENCE / LATENCY_S  plan fields
 *
 * Inbox mode (no public URL):
 *   SELLER_KEY=uw_seller_… node workers/local-seller/index.mjs
 *
 * Webhook mode:
 *   SELLER_KEY=uw_seller_… WEBHOOK_PORT=8787 WEBHOOK_URL=http://127.0.0.1:8787/ \
 *     node workers/local-seller/index.mjs
 */
import http from "node:http";

const BASE = (process.env.UNDERWRITE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = (process.env.SELLER_KEY ?? "").trim();
const POLL_MS = Number(process.env.POLL_MS ?? 1000);
const WEBHOOK_PORT = process.env.WEBHOOK_PORT ? Number(process.env.WEBHOOK_PORT) : 0;
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? (WEBHOOK_PORT ? `http://127.0.0.1:${WEBHOOK_PORT}/` : "");
const PRICE_USD = Number(process.env.PRICE_USD ?? 0.03);
const CONFIDENCE = Number(process.env.CONFIDENCE ?? 0.96);
const LATENCY_S = Number(process.env.LATENCY_S ?? 10);

if (!KEY) {
  console.error("SELLER_KEY is required (mint a seller key on /keys or /agents/register)");
  process.exit(1);
}

const seen = new Set();

function headers(json = false) {
  const h = { authorization: `Bearer ${KEY}` };
  if (json) h["content-type"] = "application/json";
  return h;
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(Boolean(init.body)), ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const err = new Error(`${init.method ?? "GET"} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function handleMessage(msg) {
  const type = msg.type ?? msg.payload?.type;
  const jobId = msg.job_id ?? msg.request_id ?? msg.payload?.job_id ?? msg.payload?.request_id;
  const key = `${type}:${jobId}:${msg.inbox_id ?? "wh"}`;
  if (!jobId || seen.has(key)) return;
  seen.add(key);

  if (type === "plan_request") {
    console.log(`[seller] plan_request ${jobId} — posting one plan+price (no reprice)`);
    const plan = await api(`/api/v1/jobs/${jobId}/plans`, {
      method: "POST",
      body: JSON.stringify({
        approach: "Local stub: compile the HTML to a clean A4 PDF at the declared SLA.",
        steps: ["read brief", "render PDF", "return artifact"],
        price_usd: PRICE_USD,
        promised_confidence: CONFIDENCE,
        max_latency_s: LATENCY_S,
      }),
    });
    console.log(`[seller] plan ${plan.plan?.plan_id ?? plan.plan_id} posted @ $${PRICE_USD}`);
    return;
  }

  if (type === "accepted") {
    console.log(`[seller] accepted ${jobId} — posting stub deliverable`);
    const result = await api(`/api/v1/jobs/${jobId}/deliverables`, {
      method: "POST",
      body: JSON.stringify({ stub: true, self_confidence: CONFIDENCE }),
    });
    console.log(`[seller] delivered ${jobId} → ${result.status}`);
    return;
  }

  if (type === "rejected") {
    console.log(`[seller] rejected ${jobId} — ${msg.payload?.reason ?? "best-score chose someone else"}`);
  }
}

async function pollInbox() {
  const data = await api("/api/v1/agents/me/inbox?unread=1&mark_read=1");
  for (const msg of data.messages ?? []) await handleMessage(msg);
}

function startWebhook() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, agent: "local-seller" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    try {
      await handleMessage({ type: payload.type, payload, job_id: payload.job_id, request_id: payload.request_id });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      console.error("[seller] webhook handler failed", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  server.listen(WEBHOOK_PORT, () => {
    console.log(`[seller] webhook listening on :${WEBHOOK_PORT} (express-shaped POST /)`);
  });
}

async function main() {
  const me = await api("/api/v1/agents/me");
  const agentId = me.agent?.agent_id;
  console.log(`[seller] bound to ${agentId} @ ${BASE}`);

  if (WEBHOOK_PORT) {
    if (WEBHOOK_URL) {
      await api("/api/v1/agents/me", { method: "PATCH", body: JSON.stringify({ webhook_url: WEBHOOK_URL }) });
      console.log(`[seller] registered webhook_url=${WEBHOOK_URL}`);
    }
    startWebhook();
  } else {
    console.log(`[seller] inbox poll every ${POLL_MS}ms (no public URL)`);
  }

  for (;;) {
    try {
      await pollInbox();
    } catch (error) {
      console.error("[seller] inbox poll failed", error instanceof Error ? error.message : error);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
