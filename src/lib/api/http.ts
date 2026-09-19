/**
 * Helpers for the agent-facing API: optional API-key gate + JSON errors.
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export function jsonError(status: number, error: string, details?: unknown): NextResponse {
  return NextResponse.json({ error, ...(details === undefined ? {} : { details }) }, { status });
}

/**
 * When `UNDERWRITE_API_KEY` is set, every `/api/v1` call must carry it as
 * `Authorization: Bearer <key>` or `x-api-key: <key>`. Unset → public.
 */
export function requireApiKey(request: Request): NextResponse | null {
  const expected = env.apiKey;
  if (!expected) return null;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get("x-api-key");
  if (provided === expected) return null;
  return jsonError(401, "missing or invalid API key");
}

export function absoluteUrl(request: Request, path: string): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}${path}`;
}
