import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ["tests/setup.ts"],
    env: {
      // Every test process gets a fresh in-memory Postgres (PGlite).
      DATABASE_URL: "pglite://memory",
      DEMO_STEP_DELAY_MS: "0",
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
