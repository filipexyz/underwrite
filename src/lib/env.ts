/**
 * Environment access with feature flags.
 *
 * Database, Auth0, and exporters still degrade to documented no-ops when unset
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

  /**
   * Auth0 Regular Web App. All four of domain / client id / client secret /
   * cookie secret must be set; otherwise the proxy is a pass-through and human
   * pages treat the caller as `local-dev`.
   */
  get auth0() {
    const domain = read("AUTH0_DOMAIN");
    const clientId = read("AUTH0_CLIENT_ID");
    const clientSecret = read("AUTH0_CLIENT_SECRET");
    const secret = read("AUTH0_SECRET");
    const audienceExplicit = read("AUTH0_AUDIENCE");
    return {
      enabled: Boolean(domain && clientId && clientSecret && secret),
      domain,
      clientId,
      clientSecret,
      secret,
      audience: audienceExplicit ?? "https://api.underwrite",
      audienceConfigured: Boolean(audienceExplicit),
      appBaseUrl: read("APP_BASE_URL") ?? read("AUTH0_BASE_URL"),
    };
  },

  /**
   * HS256 secret for auth.md identity assertions + access tokens.
   * Prefer `UNDERWRITE_TOKEN_SECRET`; falls back to `AUTH0_SECRET`, then a
   * documented local stub (never use the stub in production).
   */
  get tokenSecret(): string {
    return read("UNDERWRITE_TOKEN_SECRET") ?? read("AUTH0_SECRET") ?? "underwrite-dev-token-secret";
  },

  /** Optional legacy global bearer for `/api/v1/*`. Prefer hashed DB keys or JWTs. */
  get apiKey(): string | undefined {
    return read("UNDERWRITE_API_KEY");
  },

  /**
   * Optional bootstrap admin allowlist (comma-separated Auth0 `sub` values).
   * Primary admin check is the `https://underwrite/roles` claim (or `app_metadata.role`).
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

  /**
   * Legacy *platform-wide* HMAC secret. Hosted agents use a per-agent
   * `whsec_…` stored encrypted on `agent_runtime_secrets`. This value is
   * only a fallback for seed / self-hosted agents that have no row.
   */
  get webhookSecret(): string {
    return read("UNDERWRITE_WEBHOOK_SECRET") ?? "underwrite-webhook-stub";
  },

  /**
   * Public origin of the multi-tenant Cloudflare seller Worker
   * (`https://underwrite-cloudflare-seller.<account>.workers.dev`).
   * Create-agent sets `webhook_url` to `{base}/webhook/{agentId}`.
   */
  get hostedSellerBaseUrl(): string | undefined {
    const value = read("HOSTED_SELLER_BASE_URL") ?? read("UNDERWRITE_HOSTED_SELLER_URL");
    return value ? value.replace(/\/+$/, "") : undefined;
  },

  /**
   * Shared secret the Worker uses to pull/push per-agent credentials.
   * Distinct from user seller keys and from `UNDERWRITE_WEBHOOK_SECRET`.
   */
  get hostedRuntimeSecret(): string | undefined {
    return read("UNDERWRITE_HOSTED_RUNTIME_SECRET");
  },

  /**
   * AES-256-GCM key for `agent_runtime_secrets`. Unset → documented stub
   * (local / tests only). Production must set `UNDERWRITE_SECRETS_KEY`.
   */
  get secretsKeyConfigured(): boolean {
    return Boolean(read("UNDERWRITE_SECRETS_KEY"));
  },

  /** Origin this process advertises to the Worker (plans / deliverables). */
  get publicBaseUrl(): string {
    return (read("UNDERWRITE_BASE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  },

  /**
   * Agora + OpenAI GPT Live (interview pool). All three are required to start
   * a voice session. Missing keys disable `/interviews` start/finalize agent
   * calls with HTTP 503 — the marketplace is untouched.
   */
  get agora() {
    const appId = read("NEXT_PUBLIC_AGORA_APP_ID");
    const certificate = read("AGORA_APP_CERTIFICATE") ?? read("NEXT_AGORA_APP_CERTIFICATE");
    /*
     * GPT Live opens an **OpenAI Realtime** session, so this must be an OpenAI key with Realtime access.
     *
     * `MODEL_PROVIDER_API_KEY` used to be in this fallback chain, and that is a trap: the marketplace's
     * own provider key (NeuraLake) is not an OpenAI key, so a missing `AGORA_OPENAI_API_KEY` looked like a
     * *valid* configuration, the agent was created, joined the channel, and was torn down ~2s later with
     * `type=invalid_request_error` — in every surface, with nothing in our logs.
     *
     * If someone genuinely wants the provider key here, they can set AGORA_OPENAI_API_KEY to it.
     */
    const openaiKey = read("AGORA_OPENAI_API_KEY") ?? read("NEXT_OPENAI_API_KEY") ?? read("OPENAI_API_KEY");
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
