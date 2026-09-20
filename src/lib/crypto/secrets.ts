/**
 * AES-256-GCM for agent runtime secrets (seller key copy, webhook HMAC,
 * BYOK). Chosen over plaintext Neon columns and over per-DO Cloudflare
 * secrets: one Worker deploy cannot call the CF API per user agent, and the
 * platform must be able to re-sign webhooks and re-provision a Durable Object.
 *
 * Key: `UNDERWRITE_SECRETS_KEY` (32-byte hex / base64, or any string hashed
 * to 32 bytes). Unset → documented SHA-256 stub so local/tests work. Rotating
 * the key invalidates stored ciphertexts.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SECRETS_STUB_MATERIAL = "underwrite-secrets-dev-stub";
const VERSION = "v1";

function readRawKey(): string | undefined {
  const value = process.env.UNDERWRITE_SECRETS_KEY;
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function secretsKeySource(): "env" | "stub" {
  return readRawKey() ? "env" : "stub";
}

export function secretsKeyBytes(): Buffer {
  const raw = readRawKey();
  if (!raw) return createHash("sha256").update(SECRETS_STUB_MATERIAL, "utf8").digest();
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    /* fall through */
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKeyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("invalid secret ciphertext");
  }
  const [, ivB64, dataB64, tagB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", secretsKeyBytes(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}
