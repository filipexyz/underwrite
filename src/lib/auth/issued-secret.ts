/**
 * One-time flash of a freshly minted seller secret across a redirect.
 * The plaintext is never stored in the database.
 */
import { cookies } from "next/headers";

const COOKIE = "uw_issued_seller_secret";
const MAX_AGE_S = 180;

export async function setIssuedSellerSecret(agentId: string, secret: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, JSON.stringify({ agentId, secret }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function peekIssuedSellerSecret(agentId: string): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { agentId?: string; secret?: string };
    if (parsed.agentId !== agentId || typeof parsed.secret !== "string" || parsed.secret.length === 0) {
      return null;
    }
    return parsed.secret;
  } catch {
    return null;
  }
}
