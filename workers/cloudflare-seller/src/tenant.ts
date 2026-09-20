import { readSellerConfig, resolveUnderwriteBaseUrl, type SellerConfig } from "./config";
import { sellerError, sellerLog } from "./log";

/** Kept well under the 2.5s webhook delivery budget on the Underwrite side. */
const PULL_TIMEOUT_MS = 2_000;

export type TenantCredentials = {
  sellerApiKey?: string;
  webhookSecret?: string;
  neuralakeApiKey?: string;
  neuralakeBaseUrl?: string;
  neuralakeModel?: string;
  underwriteBaseUrl?: string;
};

export type ProvisionByok = {
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
};

export type ProvisionBody = {
  agent_id?: string;
  underwrite_base_url?: string | null;
  seller_api_key?: string | null;
  webhook_secret?: string | null;
  byok_api_key?: string | null;
  byok_base_url?: string | null;
  byok_model?: string | null;
  /** Hosted pull (`GET /api/internal/hosted-agents/:id`) nests BYOK here. */
  byok?: ProvisionByok | null;
};

function firstText(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function credentialsFromProvision(body: ProvisionBody): TenantCredentials {
  const nested = body.byok && typeof body.byok === "object" ? body.byok : null;
  return {
    sellerApiKey: body.seller_api_key?.trim() || undefined,
    webhookSecret: body.webhook_secret?.trim() || undefined,
    neuralakeApiKey: firstText(body.byok_api_key, nested?.api_key),
    neuralakeBaseUrl: firstText(body.byok_base_url, nested?.base_url),
    neuralakeModel: firstText(body.byok_model, nested?.model),
    underwriteBaseUrl: body.underwrite_base_url?.trim() || undefined,
  };
}

/** Per-agent DO credentials win. Global env is the deprecated single-tenant fallback. */
export function mergeSellerConfig(env: Env, tenant: TenantCredentials | undefined, instanceName: string): SellerConfig {
  const base = readSellerConfig(env);
  return {
    underwriteBaseUrl: tenant?.underwriteBaseUrl || base.underwriteBaseUrl,
    sellerApiKey: tenant?.sellerApiKey || base.sellerApiKey,
    webhookSecret: tenant?.webhookSecret || base.webhookSecret,
    neuralakeBaseUrl: tenant?.neuralakeBaseUrl || base.neuralakeBaseUrl,
    neuralakeApiKey: tenant?.neuralakeApiKey || base.neuralakeApiKey,
    neuralakeModel: tenant?.neuralakeModel || base.neuralakeModel,
    instanceName,
  };
}

export async function pullHostedCredentials(env: Env, agentId: string): Promise<TenantCredentials | null> {
  const secret = (env.UNDERWRITE_HOSTED_RUNTIME_SECRET ?? "").trim();
  const base = resolveUnderwriteBaseUrl(env.UNDERWRITE_BASE_URL);
  if (!secret) {
    /*
     * Loud, not silent. Without this secret the DO can never receive credentials:
     * the pull path is dead here, and push provisioning is rejected with 401 by
     * `authorizeRuntime`. The previous silent `return null` is why an unprovisioned
     * DO looked like "the fiber woke up and did nothing".
     */
    sellerError({
      instance: agentId,
      msg: "credential_pull_skipped",
      reason: "UNDERWRITE_HOSTED_RUNTIME_SECRET is unset on this Worker",
      underwrite_base_url: base,
    });
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/internal/hosted-agents/${encodeURIComponent(agentId)}`, {
      headers: {
        authorization: `Bearer ${secret}`,
        "x-underwrite-runtime-secret": secret,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      sellerError({
        instance: agentId,
        msg: "credential_pull_failed",
        status: res.status,
        underwrite_base_url: base,
      });
      return null;
    }
    const json = (await res.json()) as { agent?: ProvisionBody };
    if (!json.agent) return null;
    const pulled = credentialsFromProvision(json.agent);
    sellerLog({
      instance: agentId,
      msg: "credential_pull_ok",
      status: res.status,
      underwrite_base_url: base,
      has_seller: Boolean(pulled.sellerApiKey),
      has_webhook: Boolean(pulled.webhookSecret),
      has_byok: Boolean(pulled.neuralakeApiKey),
    });
    return pulled;
  } catch (error) {
    // A hanging pull must not blow the 2.5s webhook budget upstream.
    sellerError({
      instance: agentId,
      msg: "credential_pull_error",
      error: error instanceof Error ? error.message : String(error),
      underwrite_base_url: base,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
