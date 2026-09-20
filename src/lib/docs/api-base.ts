/** Designed production base from the agent-market docs page. */
export const DEFAULT_PUBLIC_API_BASE = "https://underwrite-gamma.vercel.app/api/v1";

/**
 * Public `/api/v1` origin shown in docs.
 * Uses `NEXT_PUBLIC_APP_URL` when set; otherwise the designed production URL.
 * Does not invent a host from Vercel preview env.
 */
export function publicApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return DEFAULT_PUBLIC_API_BASE;
  return `${raw.replace(/\/+$/, "")}/api/v1`;
}
