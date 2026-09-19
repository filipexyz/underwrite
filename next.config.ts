import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-native packages (dynamic requires, WASM) are left to Node at runtime
  // instead of being bundled into the server build.
  serverExternalPackages: ["@mastra/core", "@mastra/observability", "@mastra/langfuse", "@electric-sql/pglite"],
};

export default nextConfig;
