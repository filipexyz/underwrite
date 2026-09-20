/**
 * Owner-only hosted runtime: BYOK, webhook rotate, hosted vs self-hosted.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  getPublicAgentRuntime,
  provisionHostedAgent,
  rotateWebhookSecret,
  setRuntimeKind,
  updateAgentByok,
} from "@/lib/marketplace/agent-runtime";
import { getOwnedAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RuntimePatch = z.object({
  kind: z.enum(["hosted", "self_hosted"]).optional(),
  webhook_url: z.string().trim().max(500).optional(),
  byok_api_key: z.string().trim().max(500).optional(),
  byok_base_url: z.string().trim().max(500).optional(),
  byok_model: z.string().trim().max(80).optional(),
  clear_byok: z.boolean().optional(),
  rotate_webhook_secret: z.boolean().optional(),
  re_provision: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { db } = await getDb();
  const agent = await getOwnedAgent(db, id, auth.identity.userId);
  if (!agent) return jsonError(404, `agent not found: ${id}`);
  return NextResponse.json({ runtime: await getPublicAgentRuntime(db, agent.agentId, agent.webhookUrl) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = RuntimePatch.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid runtime patch", parsed.error.flatten());

  const { db } = await getDb();
  const agent = await getOwnedAgent(db, id, auth.identity.userId);
  if (!agent) return jsonError(404, `agent not found: ${id}`);

  let webhookSecret: string | undefined;
  if (parsed.data.kind) {
    const custom = parsed.data.webhook_url && parsed.data.webhook_url.length > 0 ? parsed.data.webhook_url : null;
    await setRuntimeKind(db, agent.agentId, parsed.data.kind, custom);
  }
  if (parsed.data.clear_byok || parsed.data.byok_api_key || parsed.data.byok_base_url || parsed.data.byok_model) {
    const updated = await updateAgentByok(db, agent.agentId, {
      apiKey: parsed.data.byok_api_key,
      baseUrl: parsed.data.byok_base_url,
      model: parsed.data.byok_model,
      clear: parsed.data.clear_byok,
    });
    if (!updated) return jsonError(404, `runtime not found: ${id}`);
  }
  if (parsed.data.rotate_webhook_secret) {
    const rotated = await rotateWebhookSecret(db, agent.agentId);
    if (!rotated) return jsonError(404, `runtime not found: ${id}`);
    webhookSecret = rotated;
  }
  if (parsed.data.re_provision) {
    await provisionHostedAgent(db, agent.agentId);
  }

  const fresh = await getOwnedAgent(db, id, auth.identity.userId);
  return NextResponse.json({
    runtime: await getPublicAgentRuntime(db, agent.agentId, fresh?.webhookUrl ?? agent.webhookUrl),
    webhook_secret: webhookSecret,
    warning: webhookSecret ? "copy this webhook secret now — the UI will not show it again" : undefined,
  });
}
