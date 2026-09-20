import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LOCAL_UNDERWRITE_BASE_URL,
  PRODUCTION_UNDERWRITE_BASE_URL,
  readSellerConfig,
  resolveUnderwriteBaseUrl,
} from "../src/config";

function envFile(name: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", name), "utf8");
}

describe("UNDERWRITE_BASE_URL production contract", () => {
  it("does not bake localhost into wrangler.jsonc vars (CI deploy overwrites dashboard)", () => {
    const wrangler = envFile("wrangler.jsonc");
    const match = wrangler.match(/"UNDERWRITE_BASE_URL"\s*:\s*"([^"]+)"/);
    expect(match?.[1]).toBe(PRODUCTION_UNDERWRITE_BASE_URL);
    expect(match?.[1]).not.toMatch(/localhost|127\.0\.0\.1/i);
  });

  it("keeps localhost only in .dev.vars.example for wrangler dev", () => {
    const devVars = envFile(".dev.vars.example");
    expect(devVars).toMatch(new RegExp(`^UNDERWRITE_BASE_URL=${LOCAL_UNDERWRITE_BASE_URL.replace(/[.]/g, "\\.")}$`, "m"));
    expect(devVars).toMatch(/localhost only|only place localhost/i);
  });

  it("falls back to the production origin when the env var is unset", () => {
    expect(resolveUnderwriteBaseUrl(undefined)).toBe(PRODUCTION_UNDERWRITE_BASE_URL);
    expect(resolveUnderwriteBaseUrl("")).toBe(PRODUCTION_UNDERWRITE_BASE_URL);
    expect(resolveUnderwriteBaseUrl("https://underwrite-gamma.vercel.app/")).toBe(PRODUCTION_UNDERWRITE_BASE_URL);
    expect(resolveUnderwriteBaseUrl(LOCAL_UNDERWRITE_BASE_URL)).toBe(LOCAL_UNDERWRITE_BASE_URL);
  });

  it("health config uses the production fallback, not localhost", () => {
    const cfg = readSellerConfig({} as Env);
    expect(cfg.underwriteBaseUrl).toBe(PRODUCTION_UNDERWRITE_BASE_URL);
  });
});
