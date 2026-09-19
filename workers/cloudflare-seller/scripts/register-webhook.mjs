#!/usr/bin/env node
/**
 * PATCH /api/v1/agents/me { webhook_url } with the seller key.
 *
 *   UNDERWRITE_BASE_URL=http://localhost:3000 \
 *   UNDERWRITE_SELLER_API_KEY=uw_seller_… \
 *   WEBHOOK_URL=https://underwrite-cloudflare-seller.<account>.workers.dev/webhook \
 *     node scripts/register-webhook.mjs
 */
const base = (process.env.UNDERWRITE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const key = (process.env.UNDERWRITE_SELLER_API_KEY ?? "").trim();
const webhookUrl = (process.env.WEBHOOK_URL ?? "").trim();

if (!key || !webhookUrl) {
  console.error("UNDERWRITE_SELLER_API_KEY and WEBHOOK_URL are required");
  process.exit(1);
}

const res = await fetch(`${base}/api/v1/agents/me`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ webhook_url: webhookUrl }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("PATCH /api/v1/agents/me failed", res.status, body);
  process.exit(1);
}
console.log("registered", body.agent?.agent_id, "→", body.agent?.webhook_url);
