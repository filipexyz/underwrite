/** Path + header routing for the multi-tenant hosted seller. */

export const DIRECTORY_INSTANCE = "__directory__";

export type SellerRoute =
  | { kind: "health" }
  | { kind: "legacy_webhook" }
  | { kind: "agent_webhook"; agentId: string }
  | { kind: "provision"; agentId: string }
  | { kind: "inbox_drain"; agentId?: string }
  | { kind: "other" };

export function parseSellerPath(pathname: string): SellerRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/health") return { kind: "health" };
  if (path === "/webhook") return { kind: "legacy_webhook" };
  const webhook = path.match(/^\/webhook\/([^/]+)$/);
  if (webhook) return { kind: "agent_webhook", agentId: decodeURIComponent(webhook[1]) };
  const provision = path.match(/^\/internal\/agents\/([^/]+)$/);
  if (provision) return { kind: "provision", agentId: decodeURIComponent(provision[1]) };
  if (path === "/inbox/drain") return { kind: "inbox_drain" };
  const drain = path.match(/^\/inbox\/drain\/([^/]+)$/);
  if (drain) return { kind: "inbox_drain", agentId: decodeURIComponent(drain[1]) };
  return { kind: "other" };
}

export function resolveWebhookAgentId(
  pathId: string | null,
  headerId: string | null,
  fallback: string,
): { ok: true; agentId: string } | { ok: false; error: string } {
  if (pathId && headerId && pathId !== headerId) {
    return { ok: false, error: "x-underwrite-agent-id does not match webhook path" };
  }
  const agentId = pathId || headerId || fallback;
  if (!agentId) return { ok: false, error: "missing agent id" };
  return { ok: true, agentId };
}

export function presentedRuntimeSecret(headers: Headers): string | null {
  const header = headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const raw = bearer || (headers.get("x-underwrite-runtime-secret") ?? "").trim();
  return raw.length > 0 ? raw : null;
}

export function runtimeSecretConfigured(env: { UNDERWRITE_HOSTED_RUNTIME_SECRET?: string }): string {
  return (env.UNDERWRITE_HOSTED_RUNTIME_SECRET ?? "").trim();
}

export function authorizeRuntime(headers: Headers, env: { UNDERWRITE_HOSTED_RUNTIME_SECRET?: string }): boolean {
  const expected = runtimeSecretConfigured(env);
  const presented = presentedRuntimeSecret(headers);
  if (!expected || !presented || expected.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  return mismatch === 0;
}
