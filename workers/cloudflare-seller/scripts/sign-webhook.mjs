#!/usr/bin/env node
/**
 * Sign an Underwrite seller webhook the same way the platform does:
 * HMAC-SHA256 of `${timestamp}.${body}` (`src/lib/marketplace/webhooks.ts`).
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const bodyPath = process.argv[2];
if (!bodyPath) {
  console.error("usage: node scripts/sign-webhook.mjs <fixture.json>");
  process.exit(1);
}

const body = readFileSync(bodyPath, "utf8").replace(/\s+$/, "");
const timestamp = process.env.UNDERWRITE_TIMESTAMP || String(Date.now());
const secret = process.env.UNDERWRITE_WEBHOOK_SECRET || "underwrite-webhook-stub";
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

process.stdout.write(
  JSON.stringify(
    {
      timestamp,
      signature: `sha256=${signature}`,
      body,
    },
    null,
    2,
  ) + "\n",
);
