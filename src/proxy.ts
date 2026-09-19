/**
 * Clerk protects the human console only (`/console/*`). Agent-facing routes
 * under `/api/v1/*` stay out of Clerk — they are optionally gated by
 * `UNDERWRITE_API_KEY` inside the route handlers.
 *
 * Without Clerk keys the proxy is a pass-through, so the loop runs locally
 * with an empty `.env`.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

const isConsole = createRouteMatcher(["/console(.*)"]);

const handler = env.clerk.enabled
  ? clerkMiddleware(async (auth, request) => {
      if (isConsole(request)) await auth.protect();
    })
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: ["/console(.*)"],
};
