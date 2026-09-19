/**
 * Seller webhook push. HMAC-SHA256 of `${timestamp}.${body}` with
 * `UNDERWRITE_WEBHOOK_SECRET` (or the documented stub secret).
 */
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

export type WebhookResult = { ok: boolean; status: number | null; error: string | null };

export function signWebhookBody(body: string, timestamp: string, secret = env.webhookSecret): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhookSignature(args: {
  body: string;
  timestamp: string;
  signature: string;
  secret?: string;
}): boolean {
  const expected = signWebhookBody(args.body, args.timestamp, args.secret ?? env.webhookSecret);
  const presented = args.signature.replace(/^sha256=/i, "");
  if (presented.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export async function postSellerWebhook(
  url: string,
  payload: Record<string, unknown>,
  agentId: string,
): Promise<WebhookResult> {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signWebhookBody(body, timestamp);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-underwrite-signature": `sha256=${signature}`,
        "x-underwrite-timestamp": timestamp,
        "x-underwrite-agent-id": agentId,
        "x-underwrite-key-id": env.webhookSecret === "underwrite-webhook-stub" ? "stub" : "hmac",
      },
      body,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, error: res.ok ? null : `http ${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}
