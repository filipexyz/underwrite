import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-native packages (dynamic requires, WASM) are left to Node at runtime
  // instead of being bundled into the server build.
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/observability",
    "@mastra/langfuse",
    "@electric-sql/pglite",
    "agora-agents",
    "agora-token",
    "pdf-lib",
    "@pdf-lib/fontkit",
  ],
  // Enables `forbidden()` / `unauthorized()` so `/admin` can return 403.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
