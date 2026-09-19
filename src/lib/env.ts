/**
 * Environment access with feature flags.
 *
 * Database, Clerk, and exporters still degrade to documented no-ops when unset
 * (PGlite on disk, open human pages, no tracing). Marketplace inference does
 * not: without MODEL_PROVIDER_API_KEY the API returns 503.
 */

export const NEURALAKE_DEFAULT_BASE_URL = "https://api.neuralake.cloud/v1";
export const NEURALAKE_DEFAULT_NAME = "neuralake";
export const NEURALAKE_DEFAULT_MODEL = "auto";

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
   * NeuraLake (OpenAI-compatible). Base URL and model default to the live
   * endpoint; an API key is required — there is no simulated inference.
   */
  get modelProvider() {
    const apiKey = read("MODEL_PROVIDER_API_KEY") ?? read("NEURALAKE_API_KEY") ?? read("OPENAI_API_KEY");
    const baseUrl = read("MODEL_PROVIDER_BASE_URL") ?? read("NEURALAKE_BASE_URL") ?? NEURALAKE_DEFAULT_BASE_URL;
    return {
      enabled: Boolean(apiKey),
      apiKey,
      baseUrl,
      name: read("MODEL_PROVIDER_NAME") ?? NEURALAKE_DEFAULT_NAME,
      model: read("MODEL_PROVIDER_MODEL") ?? NEURALAKE_DEFAULT_MODEL,
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
   * Locked marketplace PoC (no reprice). When `1`, `POST /api/v1/requests`
   * defaults to `execution_mode: "push"` unless the body sets `"seed"`.
   * The console "Fire demo request" button always stays on the seed Mastra loop.
   */
  get marketplacePush(): boolean {
    return read("MARKETPLACE_PUSH") === "1";
  },

  /** Plan window for the push path. Select when it elapses or every invitee responds. */
  get planWindowMs(): number {
    return Math.max(0, readNumber("PLAN_WINDOW_MS", 8_000));
  },

  /** How many hireable agents to invite on a push job. */
  get marketplaceTopK(): number {
    return Math.max(1, Math.round(readNumber("MARKETPLACE_TOP_K", 5)));
  },

  /** HMAC secret for seller webhooks. Unset → documented stub secret. */
  get webhookSecret(): string {
    return read("UNDERWRITE_WEBHOOK_SECRET") ?? "underwrite-webhook-stub";
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
