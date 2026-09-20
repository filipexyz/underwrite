import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { registerIdentity } from "@/lib/auth/auth-md";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", { error_description: "body must be JSON" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "invalid_request", { error_description: "body must be a JSON object" });
  }
  const { db } = await getDb();
  const result = await registerIdentity(db, body as Record<string, unknown>, request);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_description: result.error_description, ...result.extra },
      { status: result.status },
    );
  }
  return NextResponse.json(result.body, { status: result.status });
}
