/**
 * Auth0 protects human surfaces. Agent-facing `/api/v1/*` stays out of the
 * session gate and is authorized by hashed API keys, Auth0/auth.md JWTs, or
 * the legacy `UNDERWRITE_API_KEY`. `/interviews` is the creator pool (Auth0).
 * `/i/[token]` and `/api/v1/interviews/i/*` are public — possession of the
 * invite token is auth. `/docs` is public (agent API docs; `/developers` 301s
 * there). `/auth.md`, `/.well-known/*`, `/agent/*`, and `/oauth2/*` are the
 * open auth.md surface.
 *
 * Without Auth0 keys the proxy is a pass-through, so the loop runs locally
 * with an empty `.env`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuth0 } from "@/lib/auth0";

const PROTECTED_PREFIXES = [
  "/start",
  "/console",
  "/admin",
  "/keys",
  "/account",
  "/agents",
  "/interviews",
  "/claim",
  "/api/account",
  "/api/admin",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: Request) {
  const client = getAuth0();
  if (!client) return NextResponse.next();

  const authRes = await client.middleware(request);
  const url = new URL(request.url);
  if (url.pathname.startsWith("/auth/")) return authRes;
  if (!isProtectedPath(url.pathname)) return authRes;

  const session = await client.getSession(request as NextRequest);
  if (!session) {
    const login = new URL("/auth/login", url.origin);
    login.searchParams.set("returnTo", `${url.pathname}${url.search}`);
    const redirect = NextResponse.redirect(login);
    authRes.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return redirect;
  }
  return authRes;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
