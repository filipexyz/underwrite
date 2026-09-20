import { getAgentByName, routeAgentRequest } from "agents";
import { readSellerConfig, sanitizeInstanceName } from "./config";
import { authorizeRuntime, DIRECTORY_INSTANCE, parseSellerPath, resolveWebhookAgentId } from "./routes";
import { SellerAgent } from "./seller-agent";
import { verifyWebhookSignature, webhookHeaders } from "./webhook";

export { SellerAgent };

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

async function routeToSeller(env: Env, request: Request, instanceName: string): Promise<Response> {
  const agent = await getAgentByName(env.SellerAgent, sanitizeInstanceName(instanceName));
  return agent.fetch(request);
}

async function rememberTenant(env: Env, agentId: string): Promise<void> {
  const directory = await getAgentByName(env.SellerAgent, DIRECTORY_INSTANCE);
  await directory.fetch(
    new Request("https://seller.internal/tenants", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: agentId }),
    }),
  );
}

async function listTenants(env: Env): Promise<string[]> {
  const directory = await getAgentByName(env.SellerAgent, DIRECTORY_INSTANCE);
  const res = await directory.fetch(new Request("https://seller.internal/tenants"));
  if (!res.ok) return [];
  const body = (await res.json()) as { tenants?: string[] };
  return body.tenants ?? [];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cfg = readSellerConfig(env);
    const route = parseSellerPath(url.pathname);

    if (request.method === "GET" && route.kind === "health") {
      return json(200, {
        ok: true,
        service: "underwrite-cloudflare-seller",
        mode: "multi-tenant",
        underwrite_base_url: cfg.underwriteBaseUrl,
        neuralake_base_url: cfg.neuralakeBaseUrl,
        neuralake_model: cfg.neuralakeModel,
        hosted_runtime_secret_configured: Boolean((env.UNDERWRITE_HOSTED_RUNTIME_SECRET ?? "").trim()),
        deprecated_global_seller_key: Boolean(cfg.sellerApiKey),
        deprecated_global_byok: Boolean(cfg.neuralakeApiKey),
      });
    }

    if (route.kind === "provision" && (request.method === "PUT" || request.method === "POST")) {
      if (!authorizeRuntime(request.headers, env)) {
        return json(401, { error: "missing or invalid runtime secret" });
      }
      await rememberTenant(env, route.agentId);
      const forwarded = new Request(new URL("/provision", request.url), {
        method: "PUT",
        headers: request.headers,
        body: request.body,
      });
      return routeToSeller(env, forwarded, route.agentId);
    }

    if (route.kind === "inbox_drain" && request.method === "POST") {
      const instance = route.agentId || cfg.instanceName;
      if (route.agentId && !authorizeRuntime(request.headers, env)) {
        return json(401, { error: "missing or invalid runtime secret" });
      }
      return routeToSeller(env, request, instance);
    }

    if (
      request.method === "POST" &&
      (route.kind === "legacy_webhook" || route.kind === "agent_webhook" || url.pathname === "/")
    ) {
      const rawBody = await request.text();
      const headers = webhookHeaders(request);
      const pathId = route.kind === "agent_webhook" ? route.agentId : null;
      const resolved = resolveWebhookAgentId(pathId, headers.agentId, cfg.instanceName);
      if (!resolved.ok) return json(400, { error: resolved.error });

      if (route.kind !== "agent_webhook") {
        const ok = await verifyWebhookSignature({
          body: rawBody,
          timestamp: headers.timestamp ?? "",
          signature: headers.signature,
          secret: cfg.webhookSecret,
        });
        if (!ok) {
          return json(401, {
            error: "invalid x-underwrite-signature (HMAC-SHA256 of timestamp.body)",
          });
        }
      }

      const forwarded = new Request(new URL("/webhook", request.url), {
        method: "POST",
        headers: request.headers,
        body: rawBody,
      });
      return routeToSeller(env, forwarded, resolved.agentId);
    }

    return (await routeAgentRequest(request, env)) ?? json(404, { error: "not found" });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const tenants = await listTenants(env);
    const cfg = readSellerConfig(env);
    const ids = tenants.length > 0 ? tenants : [cfg.instanceName];
    for (const id of ids) {
      const agent = await getAgentByName(env.SellerAgent, sanitizeInstanceName(id));
      ctx.waitUntil(agent.pollInbox());
    }
  },
} satisfies ExportedHandler<Env>;
