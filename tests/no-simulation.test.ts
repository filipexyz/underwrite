import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LIVE = [
  "src/lib/observability/inference.ts",
  "src/lib/marketplace/engine.ts",
  "src/lib/marketplace/artifact.ts",
  "src/lib/verification/judges.ts",
  "src/lib/verification/inspect.ts",
  "src/lib/verification/verify.ts",
  "src/app/api/v1/requests/route.ts",
];

const BANNED = /function simulate\b|simulated_inference|simulated:\s*true|renderSimulated|falling back to simulation/;

describe("live marketplace path has no simulate branch", () => {
  it("does not contain the old simulation markers", () => {
    for (const file of LIVE) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(BANNED);
    }
  });
});
