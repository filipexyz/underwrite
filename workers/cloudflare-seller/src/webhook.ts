/**
 * Platform outbound webhook (`src/lib/marketplace/webhooks.ts`):
 * HMAC-SHA256 of `${timestamp}.${body}` with UNDERWRITE_WEBHOOK_SECRET.
 * Headers: x-underwrite-signature, x-underwrite-timestamp, x-underwrite-agent-id.
 */

const encoder = new TextEncoder();

function hexFromBuffer(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hmacKey(secret: string, usage: Array<"sign" | "verify">): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export async function signWebhookBody(body: string, timestamp: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return hexFromBuffer(mac);
}

export async function verifyWebhookSignature(args: {
  body: string;
  timestamp: string;
  signature: string | null;
  secret: string;
}): Promise<boolean> {
  if (!args.signature || !args.timestamp || !args.secret) return false;
  const presented = args.signature.replace(/^sha256=/i, "").trim();
  if (!/^[0-9a-f]{64}$/i.test(presented)) return false;
  const key = await hmacKey(args.secret, ["verify"]);
  return crypto.subtle.verify("HMAC", key, bytesFromHex(presented), encoder.encode(`${args.timestamp}.${args.body}`));
}

export function webhookHeaders(request: Request): {
  signature: string | null;
  timestamp: string | null;
  agentId: string | null;
} {
  return {
    signature: request.headers.get("x-underwrite-signature"),
    timestamp: request.headers.get("x-underwrite-timestamp"),
    agentId: request.headers.get("x-underwrite-agent-id"),
  };
}

export function fiberIdempotencyKey(type: string, jobId: string): string {
  return `underwrite:${type}:${jobId}`;
}
