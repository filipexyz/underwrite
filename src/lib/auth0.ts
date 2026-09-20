/**
 * Auth0 Next.js SDK v4 client. Constructed only when Auth0 env is complete
 * so an empty `.env` still boots (local-dev / tests).
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { env } from "@/lib/env";

let client: Auth0Client | null | undefined;

export function getAuth0(): Auth0Client | null {
  if (!env.auth0.enabled) return null;
  if (client) return client;
  const authorizationParameters: { audience?: string; scope: string } = {
    scope: "openid profile email offline_access",
  };
  // Only send `audience` when AUTH0_AUDIENCE is set — otherwise login fails
  // if the Auth0 API (Resource Server) has not been created yet.
  if (env.auth0.audienceConfigured) authorizationParameters.audience = env.auth0.audience;
  client = new Auth0Client({
    domain: env.auth0.domain,
    clientId: env.auth0.clientId,
    clientSecret: env.auth0.clientSecret,
    secret: env.auth0.secret,
    appBaseUrl: env.auth0.appBaseUrl,
    authorizationParameters,
    signInReturnToPath: "/account",
  });
  return client;
}
