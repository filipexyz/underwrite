import { jsonError } from "@/lib/api/http";
import { env } from "@/lib/env";
import type { NextResponse } from "next/server";

export const LOCAL_DEV_USER_ID = "local-dev";

/**
 * Interview APIs are a human surface. Clerk session when configured;
 * `local-dev` when Clerk is off so empty `.env` still works.
 * Marketplace `UNDERWRITE_API_KEY` is intentionally not required.
 */
export async function requireInterviewUser(): Promise<{ userId: string } | { error: NextResponse }> {
  if (!env.clerk.enabled) return { userId: LOCAL_DEV_USER_ID };
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return { error: jsonError(401, "sign in required") };
  return { userId };
}

export function agoraUnavailable(): NextResponse {
  return jsonError(503, "Interview pool is disabled: Agora / GPT Live is not configured.", {
    missing: env.agora.missing,
    docs: "See README.md — Interview pool (Agora)",
  });
}

export function agoraPublicStatus() {
  return {
    enabled: env.agora.enabled,
    missing: env.agora.missing,
    model: env.agora.model,
    preview: true,
  };
}
