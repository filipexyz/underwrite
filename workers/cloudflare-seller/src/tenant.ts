import { readSellerConfig, type SellerConfig } from "./config";

export type TenantCredentials = {
  sellerApiKey?: string;
  webhookSecret?: string;
  neuralakeApiKey?: string;
  neuralakeBaseUrl?: string;
  neuralakeModel?: string;
  underwriteBaseUrl?: string;
};

export type ProvisionBody = {
  agent_id?: string;
  underwrite_base_url?: string | null;
  seller_api_key?: string | null;
  webhook_secret?: string | null;
  byok_api_key?: string | null;
  byok_base_url?: string | null;
  byok_model?: string | null;
};

export function credentialsFromProvision(body: ProvisionBody): TenantCredentials {
  return {
    sellerApiKey: body.seller_api_key?.trim() || undefined,
    webhookSecret: body.webhook_secret?.trim() || undefined,
    neuralakeApiKey: body.byok_api_key?.trim() || undefined,
    neuralakeBaseUrl: body.byok_base_url?.trim() || undefined,
    neuralakeModel: body.byok_model?.trim() || undefined,
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
  const base = (env.UNDERWRITE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  if (!secret) return null;
  const res = await fetch(`${base}/api/internal/hosted-agents/${encodeURIComponent(agentId)}`, {
    headers: {
      authorization: `Bearer ${secret}`,
      "x-underwrite-runtime-secret": secret,
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { agent?: ProvisionBody };
  if (!json.agent) return null;
  return credentialsFromProvision(json.agent);
}
