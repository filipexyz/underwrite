/**
 * Per-agent hosted runtime: webhook HMAC, encrypted seller-key copy, BYOK.
 * Underwrite is the source of truth; the Cloudflare Worker stores a copy in
 * the Durable Object named after `agent_id`.
 */
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, generateWebhookSecret } from "@/lib/crypto/secrets";
import type { Db } from "@/lib/db/client";
import { agentRuntimeSecrets, agents, type AgentRuntimeKind, type AgentRuntimeSecretsRow } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type PublicAgentRuntime = {
  kind: AgentRuntimeKind;
  webhook_url: string | null;
  webhook_secret_configured: boolean;
  byok_configured: boolean;
  byok_base_url: string | null;
  byok_model: string | null;
  provisioned: boolean;
  hosted_webhook_url: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

export type DecryptedAgentRuntime = {
  agentId: string;
  kind: AgentRuntimeKind;
  sellerApiKey: string | null;
  sellerKeyId: string | null;
  webhookSecret: string;
  byokApiKey: string | null;
  byokBaseUrl: string | null;
  byokModel: string | null;
  provisionedAt: Date | null;
};

export type HostedAgentBundle = {
  agent_id: string;
  status: string;
  owner_user_id: string | null;
  webhook_url: string | null;
  underwrite_base_url: string;
  seller_api_key: string | null;
  webhook_secret: string;
  byok_api_key: string | null;
  byok_base_url: string | null;
  byok_model: string | null;
  byok: { api_key: string; base_url: string | null; model: string | null } | null;
};

export function hostedWebhookUrl(agentId: string): string | null {
  const base = env.hostedSellerBaseUrl;
  if (!base) return null;
  return `${base}/webhook/${encodeURIComponent(agentId)}`;
}

export function toPublicRuntime(row: AgentRuntimeSecretsRow | null, webhookUrl: string | null): PublicAgentRuntime {
  return {
    kind: row?.runtimeKind ?? "hosted",
    webhook_url: webhookUrl,
    webhook_secret_configured: Boolean(row?.webhookSecretCiphertext),
    byok_configured: Boolean(row?.byokCiphertext),
    byok_base_url: row?.byokBaseUrl ?? null,
    byok_model: row?.byokModel ?? null,
    provisioned: Boolean(row?.provisionedAt),
    hosted_webhook_url: hostedWebhookUrl(row?.agentId ?? ""),
    last_error: row?.lastError ?? null,
    last_error_at: row?.lastErrorAt ? row.lastErrorAt.toISOString() : null,
  };
}

export async function getRuntimeRow(db: Db, agentId: string): Promise<AgentRuntimeSecretsRow | null> {
  const [row] = await db.select().from(agentRuntimeSecrets).where(eq(agentRuntimeSecrets.agentId, agentId)).limit(1);
  return row ?? null;
}

export async function getPublicAgentRuntime(db: Db, agentId: string, webhookUrl: string | null): Promise<PublicAgentRuntime> {
  const row = await getRuntimeRow(db, agentId);
  return toPublicRuntime(row, webhookUrl);
}

export function decryptRuntimeRow(row: AgentRuntimeSecretsRow): DecryptedAgentRuntime {
  return {
    agentId: row.agentId,
    kind: row.runtimeKind,
    sellerApiKey: row.sellerKeyCiphertext ? decryptSecret(row.sellerKeyCiphertext) : null,
    sellerKeyId: row.sellerKeyId,
    webhookSecret: decryptSecret(row.webhookSecretCiphertext),
    byokApiKey: row.byokCiphertext ? decryptSecret(row.byokCiphertext) : null,
    byokBaseUrl: row.byokBaseUrl,
    byokModel: row.byokModel,
    provisionedAt: row.provisionedAt,
  };
}

export async function resolveWebhookSecret(db: Db, agentId: string): Promise<{ secret: string; keyId: string }> {
  const row = await getRuntimeRow(db, agentId);
  if (row?.webhookSecretCiphertext) {
    return { secret: decryptSecret(row.webhookSecretCiphertext), keyId: `agent:${agentId}` };
  }
  return {
    secret: env.webhookSecret,
    keyId: env.webhookSecret === "underwrite-webhook-stub" ? "stub" : "hmac",
  };
}

export async function createAgentRuntime(
  db: Db,
  args: {
    agentId: string;
    kind: AgentRuntimeKind;
    sellerApiKey: string;
    sellerKeyId: string;
    webhookSecret?: string;
    byokApiKey?: string;
    byokBaseUrl?: string;
    byokModel?: string;
  },
): Promise<{ webhookSecret: string; row: AgentRuntimeSecretsRow }> {
  const webhookSecret = args.webhookSecret ?? generateWebhookSecret();
  const [row] = await db
    .insert(agentRuntimeSecrets)
    .values({
      agentId: args.agentId,
      runtimeKind: args.kind,
      sellerKeyCiphertext: encryptSecret(args.sellerApiKey),
      webhookSecretCiphertext: encryptSecret(webhookSecret),
      byokCiphertext: args.byokApiKey ? encryptSecret(args.byokApiKey) : null,
      byokBaseUrl: args.byokBaseUrl ?? null,
      byokModel: args.byokModel ?? null,
      sellerKeyId: args.sellerKeyId,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return { webhookSecret, row };
  const existing = await getRuntimeRow(db, args.agentId);
  if (!existing) throw new Error(`failed to persist runtime for ${args.agentId}`);
  return { webhookSecret: decryptSecret(existing.webhookSecretCiphertext), row: existing };
}

export async function bindHostedSellerKey(db: Db, agentId: string, sellerApiKey: string, sellerKeyId: string): Promise<void> {
  const existing = await getRuntimeRow(db, agentId);
  if (!existing) return;
  await db
    .update(agentRuntimeSecrets)
    .set({
      sellerKeyCiphertext: encryptSecret(sellerApiKey),
      sellerKeyId,
      updatedAt: new Date(),
    })
    .where(eq(agentRuntimeSecrets.agentId, agentId));
  await provisionHostedAgent(db, agentId);
}

export async function updateAgentByok(
  db: Db,
  agentId: string,
  patch: { apiKey?: string | null; baseUrl?: string | null; model?: string | null; clear?: boolean },
): Promise<AgentRuntimeSecretsRow | null> {
  const existing = await getRuntimeRow(db, agentId);
  if (!existing) return null;
  const [row] = await db
    .update(agentRuntimeSecrets)
    .set({
      byokCiphertext: patch.clear ? null : patch.apiKey ? encryptSecret(patch.apiKey) : existing.byokCiphertext,
      byokBaseUrl: patch.baseUrl === undefined ? existing.byokBaseUrl : patch.baseUrl,
      byokModel: patch.model === undefined ? existing.byokModel : patch.model,
      updatedAt: new Date(),
    })
    .where(eq(agentRuntimeSecrets.agentId, agentId))
    .returning();
  await provisionHostedAgent(db, agentId);
  return row ?? null;
}

export async function rotateWebhookSecret(db: Db, agentId: string): Promise<string | null> {
  const existing = await getRuntimeRow(db, agentId);
  if (!existing) return null;
  const webhookSecret = generateWebhookSecret();
  await db
    .update(agentRuntimeSecrets)
    .set({
      webhookSecretCiphertext: encryptSecret(webhookSecret),
      provisionedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(agentRuntimeSecrets.agentId, agentId));
  await provisionHostedAgent(db, agentId);
  return webhookSecret;
}

export async function setRuntimeKind(
  db: Db,
  agentId: string,
  kind: AgentRuntimeKind,
  webhookUrl?: string | null,
): Promise<void> {
  const existing = await getRuntimeRow(db, agentId);
  if (existing) {
    await db
      .update(agentRuntimeSecrets)
      .set({ runtimeKind: kind, updatedAt: new Date() })
      .where(eq(agentRuntimeSecrets.agentId, agentId));
  }
  if (kind === "hosted") {
    const hosted = hostedWebhookUrl(agentId);
    if (hosted) {
      await db.update(agents).set({ webhookUrl: hosted, updatedAt: new Date() }).where(eq(agents.agentId, agentId));
    }
    await provisionHostedAgent(db, agentId);
    return;
  }
  if (webhookUrl !== undefined) {
    await db.update(agents).set({ webhookUrl: webhookUrl ?? null, updatedAt: new Date() }).where(eq(agents.agentId, agentId));
  }
}

export async function loadHostedAgentBundle(db: Db, agentId: string): Promise<HostedAgentBundle | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
  const runtime = await getRuntimeRow(db, agentId);
  if (!agent || !runtime) return null;
  const decrypted = decryptRuntimeRow(runtime);
  return {
    agent_id: agent.agentId,
    status: agent.status,
    owner_user_id: agent.ownerUserId,
    webhook_url: agent.webhookUrl,
    underwrite_base_url: env.publicBaseUrl,
    seller_api_key: decrypted.sellerApiKey,
    webhook_secret: decrypted.webhookSecret,
    byok_api_key: decrypted.byokApiKey,
    byok_base_url: decrypted.byokBaseUrl,
    byok_model: decrypted.byokModel,
    byok: decrypted.byokApiKey
      ? {
          api_key: decrypted.byokApiKey,
          base_url: decrypted.byokBaseUrl,
          model: decrypted.byokModel,
        }
      : null,
  };
}

export async function recordRuntimeLastError(
  db: Db,
  agentId: string,
  lastError: string | null,
): Promise<void> {
  const existing = await getRuntimeRow(db, agentId);
  if (!existing) return;
  await db
    .update(agentRuntimeSecrets)
    .set({
      lastError: lastError && lastError.trim().length > 0 ? lastError.trim().slice(0, 2000) : null,
      lastErrorAt: lastError && lastError.trim().length > 0 ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(agentRuntimeSecrets.agentId, agentId));
}

export async function markRuntimeProvisioned(db: Db, agentId: string, ok: boolean): Promise<void> {
  await db
    .update(agentRuntimeSecrets)
    .set({ provisionedAt: ok ? new Date() : null, updatedAt: new Date() })
    .where(eq(agentRuntimeSecrets.agentId, agentId));
}

/**
 * Push credentials into the agent's Durable Object. Failures are non-fatal:
 * the Worker can pull `GET /api/internal/hosted-agents/:id` on first webhook.
 */
export async function provisionHostedAgent(db: Db, agentId: string): Promise<{ ok: boolean; error: string | null }> {
  const bundle = await loadHostedAgentBundle(db, agentId);
  if (!bundle) return { ok: false, error: "runtime not found" };
  if (bundle.status === "disabled") return { ok: true, error: null };
  const base = env.hostedSellerBaseUrl;
  const secret = env.hostedRuntimeSecret;
  if (!base || !secret) {
    return { ok: false, error: "HOSTED_SELLER_BASE_URL or UNDERWRITE_HOSTED_RUNTIME_SECRET is unset" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${base}/internal/agents/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
        "x-underwrite-runtime-secret": secret,
      },
      body: JSON.stringify({
        agent_id: bundle.agent_id,
        underwrite_base_url: bundle.underwrite_base_url,
        seller_api_key: bundle.seller_api_key,
        webhook_secret: bundle.webhook_secret,
        byok_api_key: bundle.byok?.api_key ?? null,
        byok_base_url: bundle.byok?.base_url ?? null,
        byok_model: bundle.byok?.model ?? null,
      }),
      signal: controller.signal,
    });
    const ok = res.ok;
    await markRuntimeProvisioned(db, agentId, ok);
    return { ok, error: ok ? null : `http ${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRuntimeProvisioned(db, agentId, false);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
