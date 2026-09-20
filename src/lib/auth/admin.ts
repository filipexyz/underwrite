/**
 * Admin is an Auth0 claim, not an org role.
 *
 * Luís sets this in Auth0 Dashboard → User Management → Users → (user) →
 * app_metadata:
 *   { "role": "admin" }
 *
 * A Post-Login Action copies that onto the ID / access token as
 * `https://underwrite/roles` (see README). `{ "admin": true }` in app_metadata
 * is also accepted. Auth0 RBAC role names that include `admin` work once the
 * Action forwards `event.authorization.roles`.
 *
 * `UNDERWRITE_ADMIN_USER_IDS` is an optional comma-separated Auth0 `sub`
 * allowlist for bootstrapping when claims are awkward.
 */
import { ROLE_CLAIM, ROLES_CLAIM, parseScopeList } from "@/lib/auth/scopes";
import { env } from "@/lib/env";

export type AdminIdentity = {
  userId?: string | null;
  claims?: Record<string, unknown>;
  roles?: string[];
};

export function parseAdminAllowlist(raw: string | undefined = env.adminUserIds): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function rolesFromClaims(claims: Record<string, unknown>): string[] {
  const roles = new Set<string>();
  for (const value of parseScopeList(claims[ROLES_CLAIM])) roles.add(value.toLowerCase());
  const single = claims[ROLE_CLAIM];
  if (typeof single === "string" && single.trim()) roles.add(single.trim().toLowerCase());
  if (typeof claims.role === "string" && claims.role.trim()) roles.add(claims.role.trim().toLowerCase());
  for (const value of parseScopeList(claims.roles)) roles.add(value.toLowerCase());
  const metadata = asRecord(claims.app_metadata);
  if (typeof metadata.role === "string" && metadata.role.trim()) roles.add(metadata.role.trim().toLowerCase());
  if (metadata.admin === true) roles.add("admin");
  return [...roles];
}

export function isAdminUser(identity: AdminIdentity, allowlist: string[] = parseAdminAllowlist()): boolean {
  const userId = identity.userId ?? null;
  if (userId && allowlist.includes(userId)) return true;
  const roles = identity.roles ?? rolesFromClaims(asRecord(identity.claims));
  return roles.includes("admin");
}
