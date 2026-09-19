/**
 * Helpers for the agent-facing API: API-key gate + JSON errors.
 *
 * Buyer routes accept the legacy env `UNDERWRITE_API_KEY` or a non-revoked
 * hashed buyer / admin_service key. When neither a presented key nor the
 * legacy env is set, `/api/v1/requests*` stays public for the demoday loop.
 */
import { NextResponse } from "next/server";
import {
  extractPresentedKey,
  resolveBuyerAuth,
  resolveSellerAuth,
  type BuyerAuth,
} from "@/lib/auth/api-keys";
import { getDb } from "@/lib/db/client";
import type { ApiKeyRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  findInferenceError,
  InferenceNotConfiguredError,
  MODEL_PROVIDER_REQUIRED_MESSAGE,
} from "@/lib/observability/inference";

export function jsonError(status: number, error: string, details?: unknown): NextResponse {
  return NextResponse.json({ error, ...(details === undefined ? {} : { details }) }, { status });
}

export async function authorizeBuyerRequest(
  request: Request,
): Promise<{ ok: true; auth: BuyerAuth } | { ok: false; response: NextResponse }> {
  const { db } = await getDb();
  const result = await resolveBuyerAuth({
    presented: extractPresentedKey(request.headers),
    legacyKey: env.apiKey,
    db,
  });
  if (!result.ok) return { ok: false, response: jsonError(result.status, result.error) };
  return { ok: true, auth: result.auth };
}

export async function requireApiKey(request: Request): Promise<NextResponse | null> {
  const auth = await authorizeBuyerRequest(request);
  return auth.ok ? null : auth.response;
}

export async function requireSellerKey(
  request: Request,
): Promise<{ ok: true; key: ApiKeyRow; agentId: string } | { ok: false; response: NextResponse }> {
  const { db } = await getDb();
  const result = await resolveSellerAuth({
    presented: extractPresentedKey(request.headers),
    db,
  });
  if (!result.ok) return { ok: false, response: jsonError(result.status, result.error) };
  return { ok: true, key: result.key, agentId: result.agentId };
}

export function absoluteUrl(request: Request, path: string): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}${path}`;
}

/** 503 when NeuraLake is not configured. Marketplace requests must not simulate. */
export function modelProviderUnavailableResponse(): NextResponse | null {
  if (env.modelProvider.enabled) return null;
  return jsonError(503, MODEL_PROVIDER_REQUIRED_MESSAGE, new InferenceNotConfiguredError().details);
}

export function inferenceErrorResponse(error: unknown): NextResponse | null {
  const found = findInferenceError(error);
  if (!found) return null;
  return jsonError(found.httpStatus, found.message, found.details);
}
