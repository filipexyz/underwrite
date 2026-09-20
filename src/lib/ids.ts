import { randomBytes, randomUUID } from "node:crypto";

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
  | "sess"
  | "voice"
  | "inbox"
  | "inv"
  | "reg"
  | "cla";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Unguessable share token for `/i/[token]`. Possession of the link is auth. */
export function newInviteToken(): string {
  return randomBytes(18).toString("base64url");
}

/** Monotonic-enough timestamp in ms for ledger rows (ordering is by `seq`). */
export function nowMs(): number {
  return Date.now();
}
