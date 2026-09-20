/**
 * Provisioning predicates, kept in a dependency-free module so they can be unit tested:
 * `seller-agent.ts` pulls in the `agents` SDK (and therefore `cloudflare:workers`), which
 * the Vitest node environment cannot load.
 *
 * These predicates decide whether an incoming event can possibly succeed. They are the
 * difference between a 202 that silently strands a job and a 503 that makes Underwrite
 * fall back to the inbox and retry later.
 */
import type { SellerConfig } from "./config";
import type { UnderwriteEvent } from "./protocol";

/** Events that must reach Underwrite or call NeuraLake need provisioned credentials. */
export function eventNeedsCredentials(event: UnderwriteEvent): boolean {
  if (event.type === "plan_request") return true;
  if (event.type === "accepted") return event.execute;
  return false;
}

/** Names only — never the values. Safe to log and to return in an error body. */
export function missingCredentials(cfg: SellerConfig): string[] {
  const missing: string[] = [];
  if (!cfg.sellerApiKey) missing.push("seller_api_key");
  if (!cfg.neuralakeApiKey) missing.push("byok_api_key");
  return missing;
}
