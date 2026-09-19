/**
 * Clerk protects human surfaces. Agent-facing `/api/v1/*` stays out of Clerk
 * and is gated by hashed API keys (or the legacy `UNDERWRITE_API_KEY`).
 * `/interviews` is the creator pool (Clerk). `/i/[token]` and
 * `/api/v1/interviews/i/*` are public — possession of the invite token is auth.
 * Interviewees are not Underwrite users. `/developers` is public: agent identity
 * is the pasted API key, not Clerk.
 *
 * Without Clerk keys the proxy is a pass-through, so the loop runs locally
 * with an empty `.env`.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

const isProtected = createRouteMatcher([
  "/console(.*)",
  "/admin(.*)",
  "/keys(.*)",
  "/account(.*)",
  "/agents(.*)",
  "/interviews(.*)",
  "/api/account(.*)",
  "/api/admin(.*)",
]);

const handler = env.clerk.enabled
  ? clerkMiddleware(async (auth, request) => {
      if (isProtected(request)) await auth.protect();
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
