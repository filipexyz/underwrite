import { NextResponse } from "next/server";
import { exchangeToken } from "@/lib/auth/auth-md";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(json ?? {})) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  const params = await readParams(request);
  const { db } = await getDb();
  const result = await exchangeToken(db, params, request);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_description: result.error_description, ...result.extra },
      { status: result.status },
    );
  }
  return NextResponse.json(result.body, { status: result.status });
}
