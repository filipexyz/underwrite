/**
 * Shared secret between Underwrite and the hosted Cloudflare seller Worker.
 * Not a user session and not a `uw_seller_` key.
 */
import { extractPresentedKey, secretsMatch } from "@/lib/auth/api-keys";
import { jsonError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { NextResponse } from "next/server";

export function presentedRuntimeSecret(headers: Headers): string | null {
  return extractPresentedKey(headers) ?? headers.get("x-underwrite-runtime-secret")?.trim() ?? null;
}

export function authorizeHostedRuntime(
  headers: Headers,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = env.hostedRuntimeSecret;
  if (!expected) {
    return { ok: false, status: 503, error: "hosted runtime is not configured (UNDERWRITE_HOSTED_RUNTIME_SECRET)" };
  }
  const presented = presentedRuntimeSecret(headers);
  if (!presented || !secretsMatch(presented, expected)) {
    return { ok: false, status: 401, error: "missing or invalid runtime secret" };
  }
  return { ok: true };
}

export function requireHostedRuntime(headers: Headers): { ok: true } | { ok: false; response: NextResponse } {
  const result = authorizeHostedRuntime(headers);
  if (!result.ok) return { ok: false, response: jsonError(result.status, result.error) };
  return { ok: true };
}
