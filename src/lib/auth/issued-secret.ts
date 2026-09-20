/**
 * One-time flash of freshly minted secrets across a redirect.
 * Seller keys stay hashed-only in `api_keys`. Webhook secrets are stored
 * encrypted for the Worker, but the UI still shows them once.
 */
import { cookies } from "next/headers";

const COOKIE = "uw_issued_seller_secret";
const MAX_AGE_S = 180;

export type IssuedAgentSecrets = {
  seller: string | null;
  webhook: string | null;
};

export async function setIssuedAgentSecrets(
  agentId: string,
  secrets: { seller?: string; webhook?: string },
): Promise<void> {
  const store = await cookies();
  store.set(
    COOKIE,
    JSON.stringify({
      agentId,
      secret: secrets.seller ?? "",
      webhook_secret: secrets.webhook ?? "",
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_S,
    },
  );
}

export async function setIssuedSellerSecret(agentId: string, secret: string): Promise<void> {
  await setIssuedAgentSecrets(agentId, { seller: secret });
}

export async function peekIssuedAgentSecrets(agentId: string): Promise<IssuedAgentSecrets> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return { seller: null, webhook: null };
  try {
    const parsed = JSON.parse(raw) as { agentId?: string; secret?: string; webhook_secret?: string };
    if (parsed.agentId !== agentId) return { seller: null, webhook: null };
    return {
      seller: parsed.secret && parsed.secret.length > 0 ? parsed.secret : null,
      webhook: parsed.webhook_secret && parsed.webhook_secret.length > 0 ? parsed.webhook_secret : null,
    };
  } catch {
    return { seller: null, webhook: null };
  }
}

export async function peekIssuedSellerSecret(agentId: string): Promise<string | null> {
  const peeked = await peekIssuedAgentSecrets(agentId);
  return peeked.seller;
}
