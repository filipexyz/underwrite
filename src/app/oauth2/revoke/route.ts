import { NextResponse } from "next/server";
import { revokeAccessToken } from "@/lib/auth/auth-md";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let token = "";
  if (contentType.includes("application/json")) {
    const json = (await request.json()) as { token?: string };
    token = json.token ?? "";
  } else {
    const params = new URLSearchParams(await request.text());
    token = params.get("token") ?? "";
  }
  if (token) {
    const { db } = await getDb();
    await revokeAccessToken(db, token);
  }
  return new NextResponse(null, { status: 200 });
}
