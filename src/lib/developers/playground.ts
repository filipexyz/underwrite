import { RequestInput } from "@/lib/contracts";

export const BUYER_KEY_STORAGE = "uw.playground.buyer_key";
export const SELLER_KEY_STORAGE = "uw.playground.seller_key";

/** Small valid mandate used by the docs and the playground. */
export const SAMPLE_BUYER_REQUEST = {
  task: {
    requirement: "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
    files: [{ name: "input.html", media_type: "text/html", content: "<h1>Hello</h1>" }],
  },
  max_cost_usd: 0.05,
  max_latency_s: 30,
  min_confidence: 0.95,
  failure_policy: "refund" as const,
};

export const SAMPLE_SELLER_PATCH = {
  description: "Hireable renderer for html_to_pdf.",
};

export const TERMINAL_REQUEST_STATUSES = ["completed", "failed", "no_eligible_bid"] as const;

export function isTerminalRequestStatus(status: string): boolean {
  return (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(status);
}

export function bearerHeaders(secret: string, jsonBody = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (jsonBody) headers["content-type"] = "application/json";
  const key = secret.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

export function parseJsonBody(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Validates the playground sample against the live request contract. */
export function sampleBuyerRequestParsed() {
  return RequestInput.safeParse(SAMPLE_BUYER_REQUEST);
}
