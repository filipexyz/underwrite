/**
 * Environment access with feature flags.
 *
 * Everything optional degrades to a documented no-op so the loop runs with an
 * empty `.env` (PGlite on disk, no auth, simulated inference, no exporters).
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = read(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get databaseUrl(): string | undefined {
    return read("DATABASE_URL");
  },

  /** Clerk is only wired when both keys are present. */
  get clerk() {
    const publishableKey = read("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    const secretKey = read("CLERK_SECRET_KEY");
    return {
      enabled: Boolean(publishableKey && secretKey),
      publishableKey,
      secretKey,
    };
  },

  /** Optional bearer key gating agent-facing routes (`POST /api/v1/requests`). */
  get apiKey(): string | undefined {
    return read("UNDERWRITE_API_KEY");
  },

  /**
   * Model provider (OpenAI-compatible). NeuraLake's endpoint with `model="auto"`
   * is the intended target; any OpenAI-compatible base URL works.
   */
  get modelProvider() {
    const apiKey = read("MODEL_PROVIDER_API_KEY") ?? read("NEURALAKE_API_KEY") ?? read("OPENAI_API_KEY");
    const baseUrl = read("MODEL_PROVIDER_BASE_URL") ?? read("NEURALAKE_BASE_URL");
    return {
      enabled: Boolean(apiKey && baseUrl),
      apiKey,
      baseUrl,
      name: read("MODEL_PROVIDER_NAME") ?? "neuralake",
    };
  },

  get langfuse() {
    const publicKey = read("LANGFUSE_PUBLIC_KEY");
    const secretKey = read("LANGFUSE_SECRET_KEY");
    return {
      enabled: Boolean(publicKey && secretKey),
      publicKey,
      secretKey,
      baseUrl: read("LANGFUSE_BASE_URL") ?? read("LANGFUSE_HOST"),
    };
  },

  get observability() {
    return {
      console: read("MASTRA_OBSERVABILITY_CONSOLE") === "1",
      serviceName: read("MASTRA_SERVICE_NAME") ?? "underwrite",
    };
  },

  /** Real sleep between workflow hops so the console visibly streams on stage. */
  get demoStepDelayMs(): number {
    return readNumber("DEMO_STEP_DELAY_MS", 0);
  },

  get nodeEnv(): string {
    return read("NODE_ENV") ?? "development";
  },

  get isTest(): boolean {
    return read("NODE_ENV") === "test" || read("VITEST") === "true";
  },
} as const;
