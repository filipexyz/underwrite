/**
 * Admin is a Clerk public-metadata flag, not an org role.
 *
 * Luís sets this in Clerk Dashboard → Users → Public metadata:
 *   { "role": "admin" }
 * or
 *   { "admin": true }
 *
 * `UNDERWRITE_ADMIN_USER_IDS` is an optional comma-separated Clerk user-id
 * allowlist for bootstrapping when metadata is awkward.
 */
import { env } from "@/lib/env";

export type AdminIdentity = {
  userId?: string | null;
  publicMetadata?: unknown;
};

export function parseAdminAllowlist(raw: string | undefined = env.adminUserIds): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function publicMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Metadata from a Clerk session JWT if the template includes it. */
export function metadataFromSessionClaims(claims: unknown): Record<string, unknown> {
  if (!claims || typeof claims !== "object") return {};
  const record = claims as Record<string, unknown>;
  return publicMetadataRecord(record.metadata ?? record.publicMetadata ?? record.public_metadata);
}

export function isAdminUser(identity: AdminIdentity, allowlist: string[] = parseAdminAllowlist()): boolean {
  const userId = identity.userId ?? null;
  if (userId && allowlist.includes(userId)) return true;

  const metadata = publicMetadataRecord(identity.publicMetadata);
  if (metadata.role === "admin") return true;
  if (metadata.admin === true) return true;
  return false;
}
