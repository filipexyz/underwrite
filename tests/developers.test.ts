import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SAMPLE_BUYER_REQUEST,
  SAMPLE_SELLER_PATCH,
  bearerHeaders,
  formatJson,
  isTerminalRequestStatus,
  parseJsonBody,
  sampleBuyerRequestParsed,
} from "@/lib/developers/playground";
import { DEFAULT_PUBLIC_API_BASE, publicApiBaseUrl } from "@/lib/docs/api-base";
import { opsHintForPath } from "@/lib/ui/ops-hint";
import nextConfig from "../next.config";

const BANNED_UI = /agora gpt live|AGORA GPT LIVE|Agora GPT Live|GPT Live/i;

const CHROME_FILES = [
  "src/app/interviews/layout.tsx",
  "src/app/interviews/page.tsx",
  "src/app/interviews/setup-banner.tsx",
  "src/app/interviews/[id]/page.tsx",
  "src/app/page.tsx",
  "src/components/app-nav.tsx",
  "src/lib/ui/ops-hint.ts",
];

describe("interview chrome", () => {
  it("does not brand Agora / GPT Live in user-visible interview or home copy", () => {
    for (const file of CHROME_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(BANNED_UI);
    }
  });
});

describe("opsHintForPath", () => {
  it("uses product language for interviews and developer routes", () => {
    expect(opsHintForPath("/interviews", "x")).toBe("interviews · human briefs");
    expect(opsHintForPath("/interviews/need_1", "x")).toBe("interviews · human briefs");
    expect(opsHintForPath("/docs", "x")).toBe("docs · agent api");
    expect(opsHintForPath("/developers", "x")).toBe("docs · agent api");
    expect(opsHintForPath("/console", "x")).toBe("console · live ledger");
    expect(opsHintForPath("/agents/agt_demo/test", "x")).toBe("test · cloudflare agent");
    expect(opsHintForPath("/agents", "x")).toBe("agents · your fleet");
  });
});

describe("public API docs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the designed production base URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(publicApiBaseUrl()).toBe(DEFAULT_PUBLIC_API_BASE);
  });

  it("derives from NEXT_PUBLIC_APP_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/");
    expect(publicApiBaseUrl()).toBe("https://example.com/api/v1");
  });

  it("permanently redirects /developers to /docs", async () => {
    const redirects = nextConfig.redirects ? await nextConfig.redirects() : [];
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "/developers", destination: "/docs", statusCode: 301 }),
        expect.objectContaining({
          source: "/developers/:path+",
          destination: "/docs",
          statusCode: 301,
        }),
      ]),
    );
  });

  it("documents the provider webhook, plans, deliverables, and inbox", () => {
    const source = readFileSync("src/app/docs/docs-client.tsx", "utf8");
    expect(source).toContain("For providers");
    expect(source).toContain("x-underwrite-signature");
    expect(source).toContain("x-underwrite-timestamp");
    expect(source).toContain("x-underwrite-agent-id");
    expect(source).toContain("plan_request");
    expect(source).toContain("/jobs/{request_id}/plans");
    expect(source).toContain("/jobs/{request_id}/deliverables");
    expect(source).toContain("/agents/me/inbox");
    expect(source).toContain("unread=1");
    expect(source).toContain("mark_read=1");
  });
});

describe("playground helpers", () => {
  it("sample request matches the live RequestInput contract", () => {
    const parsed = sampleBuyerRequestParsed();
    expect(parsed.success).toBe(true);
  });

  it("omits Authorization when no key is pasted (open buyer routes)", () => {
    expect(bearerHeaders("")).toEqual({});
    expect(bearerHeaders("  ", true)).toEqual({ "content-type": "application/json" });
    expect(bearerHeaders(" uw_buyer_abc ", true)).toEqual({
      "content-type": "application/json",
      authorization: "Bearer uw_buyer_abc",
    });
  });

  it("parses JSON bodies and recognizes terminal request statuses", () => {
    expect(parseJsonBody(formatJson(SAMPLE_BUYER_REQUEST))).toEqual({ ok: true, value: SAMPLE_BUYER_REQUEST });
    expect(parseJsonBody("{").ok).toBe(false);
    expect(isTerminalRequestStatus("completed")).toBe(true);
    expect(isTerminalRequestStatus("no_eligible_bid")).toBe(true);
    expect(isTerminalRequestStatus("auctioning")).toBe(false);
    expect(SAMPLE_SELLER_PATCH).toHaveProperty("description");
  });
});
