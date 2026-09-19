import { env } from "@/lib/env";

/** Canonical public origin (no trailing slash). Prefer APP_BASE_URL / AUTH0_BASE_URL. */
export function publicOrigin(request?: Request): string {
  const configured = env.auth0.appBaseUrl;
  if (configured) return configured.replace(/\/$/, "");
  if (request) {
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

/** Audience for Auth0 Resource Server tokens and auth.md-minted JWTs. */
export function apiAudience(): string {
  return env.auth0.audience;
}

/** Issuer for service-signed identity assertions and access tokens. */
export function tokenIssuer(request?: Request): string {
  return publicOrigin(request);
}

export function resourceUrl(request?: Request): string {
  return `${publicOrigin(request)}/api/v1`;
}
