/**
 * Marketplace API scopes. Auth0 Resource Server permissions use the same names.
 * Legacy hashed API keys keep working without these strings on the row —
 * buyer keys imply `buyer:requests`, seller keys imply the seller:* set.
 */
export const API_SCOPES = [
  "buyer:requests",
  "seller:register",
  "seller:agents",
  "seller:plans",
  "seller:deliver",
  "admin:*",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const BUYER_SCOPE: ApiScope = "buyer:requests";
export const SELLER_REGISTER_SCOPE: ApiScope = "seller:register";
export const SELLER_AGENT_SCOPE: ApiScope = "seller:agents";
export const SELLER_PLAN_SCOPE: ApiScope = "seller:plans";
export const SELLER_DELIVER_SCOPE: ApiScope = "seller:deliver";
export const ADMIN_SCOPE: ApiScope = "admin:*";

/**
 * The default bundle a seller key implies ("seller keys imply the seller:* set").
 *
 * `seller:register` is deliberately **excluded**: it authorizes creating a new provider
 * agent, and bundling it would let every seller key mint unlimited agents. It is granted
 * only when explicitly requested on `/agent/identity`, and it survives the claim ceremony
 * even when the ownership-bound scopes are dropped.
 */
export const SELLER_SCOPES: ApiScope[] = [SELLER_AGENT_SCOPE, SELLER_PLAN_SCOPE, SELLER_DELIVER_SCOPE];

/** Scopes that require the identity to own a registered provider agent. */
export const OWNERSHIP_BOUND_SELLER_SCOPES: ApiScope[] = SELLER_SCOPES;

export const ROLES_CLAIM = "https://underwrite/roles";
export const ROLE_CLAIM = "https://underwrite/role";

export function parseScopeList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((part) => (typeof part === "string" ? part.split(/\s+/) : [])).filter((part) => part.length > 0);
  }
  if (typeof value === "string") return value.split(/\s+/).filter((part) => part.length > 0);
  return [];
}

export function hasScope(scopes: readonly string[], required: string): boolean {
  if (scopes.includes("*") || scopes.includes("admin:*")) return true;
  if (scopes.includes(required)) return true;
  const ns = required.split(":")[0];
  return Boolean(ns && scopes.includes(`${ns}:*`));
}

export function inferSellerScope(pathname: string): ApiScope {
  if (pathname.includes("/deliverables")) return SELLER_DELIVER_SCOPE;
  if (pathname.includes("/plans")) return SELLER_PLAN_SCOPE;
  // `POST /api/v1/agents` (creating your own provider record) is the one seller action that
  // does not require already owning an agent — so it gets its own scope. `/agents/me` still
  // resolves to `seller:agents` below.
  if (/\/api\/v1\/agents\/?$/.test(pathname)) return SELLER_REGISTER_SCOPE;
  return SELLER_AGENT_SCOPE;
}

export function isAllowedApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export function normalizeRequestedScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [BUYER_SCOPE];
  const next = raw.filter((item): item is ApiScope => typeof item === "string" && isAllowedApiScope(item) && item !== ADMIN_SCOPE);
  return next.length > 0 ? [...new Set(next)] : [BUYER_SCOPE];
}
