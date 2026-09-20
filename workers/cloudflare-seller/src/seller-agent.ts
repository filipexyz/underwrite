import { Agent } from "agents";
import type { FiberRecoveryContext } from "agents";
import { requireNeuralakeKey, requireSellerKey, type SellerConfig } from "./config";
import { runAcceptedJob } from "./execute";
import { draftPlanWithNeuralake } from "./plan";
import {
  parseUnderwriteEvent,
  type PlanRequestEvent,
  type UnderwriteEvent,
} from "./protocol";
import { DIRECTORY_INSTANCE } from "./routes";
import { credentialsFromProvision, mergeSellerConfig, pullHostedCredentials, type TenantCredentials } from "./tenant";
import { createUnderwriteClient, isAlreadyDone, type UnderwriteClient } from "./underwrite";
import { fiberIdempotencyKey, verifyWebhookSignature, webhookHeaders } from "./webhook";

export type JobMemory = {
  brief?: PlanRequestEvent["brief"];
  constraints?: PlanRequestEvent["constraints"];
  planPosted?: boolean;
  delivered?: boolean;
  lastType?: string;
};

export type SellerState = {
  jobs: Record<string, JobMemory>;
  credentials?: TenantCredentials;
  tenants?: string[];
};

type FiberSnapshot = {
  event: UnderwriteEvent;
};

function mergeJob(state: SellerState, jobId: string, patch: Partial<JobMemory>): SellerState {
  const current = state.jobs[jobId] ?? {};
  return { jobs: { ...state.jobs, [jobId]: { ...current, ...patch } } };
}

export class SellerAgent extends Agent<Env, SellerState> {
  initialState: SellerState = { jobs: {}, tenants: [] };

  private cfg(): SellerConfig {
    return mergeSellerConfig(this.env, this.state.credentials, this.name);
  }

  private client(): UnderwriteClient {
    const cfg = this.cfg();
    return createUnderwriteClient(cfg.underwriteBaseUrl, requireSellerKey(cfg));
  }

  private async ensureCredentials(): Promise<SellerConfig> {
    const current = this.cfg();
    if (current.sellerApiKey && current.webhookSecret) return current;
    if (this.name === DIRECTORY_INSTANCE) return current;
    const pulled = await pullHostedCredentials(this.env, this.name);
    if (pulled) {
      this.setState({ ...this.state, credentials: { ...this.state.credentials, ...pulled } });
    }
    return this.cfg();
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.name === DIRECTORY_INSTANCE && url.pathname === "/tenants") {
      if (request.method === "GET") {
        return Response.json({ tenants: this.state.tenants ?? [] });
      }
      if (request.method === "PUT") {
        const body = (await request.json().catch(() => ({}))) as { agent_id?: string };
        const agentId = (body.agent_id ?? "").trim();
        if (!agentId) return Response.json({ error: "missing agent_id" }, { status: 400 });
        const tenants = new Set(this.state.tenants ?? []);
        tenants.add(agentId);
        this.setState({ ...this.state, tenants: [...tenants] });
        return Response.json({ ok: true, tenants: [...tenants] });
      }
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({
        ok: true,
        agent: "cloudflare-seller",
        instance: this.name,
        provisioned: Boolean(this.state.credentials?.sellerApiKey),
      });
    }
    if (request.method === "PUT" && url.pathname === "/provision") {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof credentialsFromProvision>[0];
      const credentials = credentialsFromProvision(body);
      this.setState({ ...this.state, credentials: { ...this.state.credentials, ...credentials } });
      return Response.json({ ok: true, agent_id: this.name, provisioned: true });
    }
    if (request.method === "POST" && url.pathname === "/inbox/drain") {
      await this.ensureCredentials();
      const result = await this.pollInbox();
      return Response.json(result);
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      const raw = await request.text();
      const headers = webhookHeaders(request);
      const cfg = await this.ensureCredentials();
      const ok = await verifyWebhookSignature({
        body: raw,
        timestamp: headers.timestamp ?? "",
        signature: headers.signature,
        secret: cfg.webhookSecret,
      });
      if (!ok) {
        return Response.json(
          { error: "invalid x-underwrite-signature (HMAC-SHA256 of timestamp.body)" },
          { status: 401 },
        );
      }
      let parsed: unknown;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      return this.acceptEvent(parsed);
    }
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    const raw = await request.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    return this.acceptEvent(parsed);
  }

  /** Durable accept: returns as soon as the fiber row is stored (Underwrite webhook timeout is 2.5s). */
  async acceptEvent(raw: unknown): Promise<Response> {
    const event = parseUnderwriteEvent(raw);
    if (!event) {
      return Response.json({ error: "unrecognized Underwrite event" }, { status: 400 });
    }

    const receipt = await this.startFiber(
      `underwrite:${event.type}`,
      async (ctx) => {
        ctx.stash({ event } satisfies FiberSnapshot);
        if (ctx.signal.aborted) throw new Error("fiber aborted");
        await this.processEvent(event, ctx.signal);
      },
      {
        idempotencyKey: fiberIdempotencyKey(event.type, event.job_id),
        metadata: { type: event.type, job_id: event.job_id },
      },
    );

    return Response.json(
      {
        ok: true,
        accepted: receipt.accepted,
        fiber_id: receipt.fiberId,
        status: receipt.status,
        type: event.type,
        job_id: event.job_id,
      },
      { status: 202 },
    );
  }

  async onFiberRecovered(ctx: FiberRecoveryContext) {
    if (!ctx.name.startsWith("underwrite:")) return;
    const snapshot = ctx.snapshot as FiberSnapshot | null;
    if (!snapshot?.event) {
      return { status: "error" as const, error: "missing underwrite fiber snapshot" };
    }
    await this.processEvent(snapshot.event);
    return { status: "completed" as const, snapshot };
  }

  async pollInbox(): Promise<{ drained: number; types: string[] }> {
    const inbox = await this.client().listInbox({ unread: true, markRead: true });
    const types: string[] = [];
    for (const message of inbox.messages ?? []) {
      const event = parseUnderwriteEvent(message);
      if (!event) continue;
      types.push(event.type);
      await this.acceptEvent(event);
    }
    return { drained: types.length, types };
  }

  private async processEvent(event: UnderwriteEvent, signal?: AbortSignal): Promise<void> {
    if (event.type === "plan_request") {
      await this.handlePlanRequest(event, signal);
      return;
    }
    if (event.type === "accepted") {
      if (!event.execute) return;
      await this.handleAccepted(event, signal);
      return;
    }
    this.setState(mergeJob(this.state, event.job_id, { lastType: "rejected" }));
  }

  private async handlePlanRequest(event: PlanRequestEvent, signal?: AbortSignal): Promise<void> {
    this.setState(
      mergeJob(this.state, event.job_id, {
        brief: event.brief,
        constraints: event.constraints,
        lastType: "plan_request",
      }),
    );
    const cfg = this.cfg();
    const plan = await draftPlanWithNeuralake({
      baseUrl: cfg.neuralakeBaseUrl,
      apiKey: requireNeuralakeKey(cfg),
      model: cfg.neuralakeModel,
      event,
      signal,
    });
    try {
      await this.client().postPlan(event.job_id, plan);
    } catch (error) {
      if (!isAlreadyDone(error, "plan")) throw error;
    }
    this.setState(mergeJob(this.state, event.job_id, { planPosted: true }));
  }

  private async handleAccepted(
    event: Extract<UnderwriteEvent, { type: "accepted" }>,
    signal?: AbortSignal,
  ): Promise<void> {
    const remembered = this.state.jobs[event.job_id];
    const brief = remembered?.brief;
    if (!brief) {
      throw new Error(`accepted ${event.job_id} but no brief in agent state — missed plan_request`);
    }
    const cfg = this.cfg();
    const deliverable = await runAcceptedJob({
      baseUrl: cfg.neuralakeBaseUrl,
      apiKey: requireNeuralakeKey(cfg),
      model: cfg.neuralakeModel,
      brief,
      accepted: event,
      signal,
    });
    try {
      await this.client().postDeliverable(event.job_id, deliverable);
    } catch (error) {
      if (!isAlreadyDone(error, "deliverable")) throw error;
    }
    this.setState(mergeJob(this.state, event.job_id, { delivered: true, lastType: "accepted" }));
  }
}
