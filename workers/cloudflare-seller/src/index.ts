import { getAgentByName, routeAgentRequest } from "agents";
import { readSellerConfig, sanitizeInstanceName } from "./config";
import { SellerAgent } from "./seller-agent";
import { verifyWebhookSignature, webhookHeaders } from "./webhook";

export { SellerAgent };

const WEBHOOK_PATHS = new Set(["/", "/webhook"]);

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

async function routeToSeller(env: Env, request: Request, instanceName: string): Promise<Response> {
  const agent = await getAgentByName(env.SellerAgent, sanitizeInstanceName(instanceName));
  return agent.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cfg = readSellerConfig(env);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(200, {
        ok: true,
        service: "underwrite-cloudflare-seller",
        underwrite_base_url: cfg.underwriteBaseUrl,
        neuralake_base_url: cfg.neuralakeBaseUrl,
        neuralake_model: cfg.neuralakeModel,
        seller_key_configured: Boolean(cfg.sellerApiKey),
        neuralake_key_configured: Boolean(cfg.neuralakeApiKey),
      });
    }

    if (url.pathname === "/inbox/drain" && request.method === "POST") {
      return routeToSeller(env, request, cfg.instanceName);
    }

    if (WEBHOOK_PATHS.has(url.pathname) && request.method === "POST") {
      const rawBody = await request.text();
      const headers = webhookHeaders(request);
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

      const instance = headers.agentId || cfg.instanceName;
      const forwarded = new Request(new URL("/webhook", request.url), {
        method: "POST",
        headers: request.headers,
        body: rawBody,
      });
      return routeToSeller(env, forwarded, instance);
    }

    return (await routeAgentRequest(request, env)) ?? json(404, { error: "not found" });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cfg = readSellerConfig(env);
    const agent = await getAgentByName(env.SellerAgent, cfg.instanceName);
    ctx.waitUntil(agent.pollInbox());
  },
} satisfies ExportedHandler<Env>;
