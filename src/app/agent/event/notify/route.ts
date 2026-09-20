import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { revokeRegistration } from "@/lib/auth/auth-md";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function registrationIdsFrom(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof record.registration_id === "string") ids.push(record.registration_id);
  if (Array.isArray(record.events)) {
    for (const event of record.events) {
      if (event && typeof event === "object" && typeof (event as { registration_id?: unknown }).registration_id === "string") {
        ids.push((event as { registration_id: string }).registration_id);
      }
    }
  }
  return [...new Set(ids)];
}

/** Provider-driven registration revoke (PoC: JSON, not a full RFC 8417 SET). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", { error_description: "body must be JSON" });
  }
  const ids = registrationIdsFrom(body);
  if (ids.length === 0) return jsonError(400, "invalid_request", { error_description: "registration_id required" });
  const { db } = await getDb();
  const revoked = [];
  for (const id of ids) {
    const row = await revokeRegistration(db, id);
    if (row) revoked.push(row.registrationId);
  }
  return NextResponse.json({ revoked });
}
