/** Structured Workers Logs lines — keep keys stable for dashboard filters. */

export function sellerLog(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: "cloudflare-seller", ts: new Date().toISOString(), ...fields }));
}

export function sellerError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ service: "cloudflare-seller", ts: new Date().toISOString(), ...fields }));
}
