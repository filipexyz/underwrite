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

  /** Optional legacy global bearer for `/api/v1/*`. Prefer hashed DB keys. */
  get apiKey(): string | undefined {
    return read("UNDERWRITE_API_KEY");
  },

  /**
   * Optional bootstrap admin allowlist (comma-separated Clerk user ids).
   * Primary admin check is Clerk `publicMetadata.role === "admin"` (or `admin: true`).
   */
  get adminUserIds(): string | undefined {
    return read("UNDERWRITE_ADMIN_USER_IDS");
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

  /**
   * Agora + OpenAI GPT Live (interview pool). All three are required to start
   * a voice session. Missing keys disable `/interviews` start/finalize agent
   * calls with HTTP 503 — the marketplace is untouched.
   */
  get agora() {
    const appId = read("NEXT_PUBLIC_AGORA_APP_ID");
    const certificate = read("AGORA_APP_CERTIFICATE") ?? read("NEXT_AGORA_APP_CERTIFICATE");
    const openaiKey =
      read("AGORA_OPENAI_API_KEY") ?? read("NEXT_OPENAI_API_KEY") ?? read("OPENAI_API_KEY") ?? read("MODEL_PROVIDER_API_KEY");
    const missing: string[] = [];
    if (!appId) missing.push("NEXT_PUBLIC_AGORA_APP_ID");
    if (!certificate) missing.push("AGORA_APP_CERTIFICATE");
    if (!openaiKey) missing.push("AGORA_OPENAI_API_KEY (or OPENAI_API_KEY)");
    return {
      enabled: missing.length === 0,
      missing,
      appId,
      certificate,
      openaiKey,
      model: read("AGORA_GPT_LIVE_MODEL") ?? "gpt-live-1",
      voice: read("AGORA_GPT_LIVE_VOICE") ?? "cedar",
      area: (read("AGORA_AREA") ?? "US").toUpperCase(),
    };
  },
} as const;
