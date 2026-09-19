import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SAMPLE_BUYER_REQUEST,
  SAMPLE_SELLER_PATCH,
  bearerHeaders,
  formatJson,
  isTerminalRequestStatus,
  parseJsonBody,
  sampleBuyerRequestParsed,
} from "@/lib/developers/playground";
import { opsHintForPath } from "@/lib/ui/ops-hint";

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
    expect(opsHintForPath("/developers", "x")).toBe("docs · agent api");
    expect(opsHintForPath("/developers/playground", "x")).toBe("playground · fire a request");
    expect(opsHintForPath("/console", "x")).toBe("console · live ledger");
  });
});

describe("playground helpers", () => {
  it("sample request matches the live RequestInput contract", () => {
    const parsed = sampleBuyerRequestParsed();
    expect(parsed.success).toBe(true);
  });

  it("omits Authorization when no key is pasted (demoday)", () => {
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
