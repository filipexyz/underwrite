import { randomUUID } from "node:crypto";

export type IdPrefix =
  | "req"
  | "bid"
  | "plan"
  | "esc"
  | "evt"
  | "ver"
  | "att"
  | "art"
  | "run"
  | "key"
  | "agt"
  | "need"
  | "sess";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Monotonic-enough timestamp in ms for ledger rows (ordering is by `seq`). */
export function nowMs(): number {
  return Date.now();
}
