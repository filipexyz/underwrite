import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/auth/auth-md";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(request), {
    headers: { "cache-control": "no-store" },
  });
}
