import { Agent } from "agents";
import type { FiberRecoveryContext } from "agents";
import { requireNeuralakeKey, requireSellerKey, resolveUnderwriteBaseUrl, type SellerConfig } from "./config";
import { runAcceptedJob } from "./execute";
import { sellerError, sellerLog } from "./log";
import { draftPlanWithNeuralake } from "./plan";
import {
  parseUnderwriteEvent,
  type PlanRequestEvent,
  type UnderwriteEvent,
} from "./protocol";
import { eventFromRecovery, mergeJob, type FiberMetadata, type FiberSnapshot } from "./recover";
import { DIRECTORY_INSTANCE } from "./routes";
import { credentialsFromProvision, mergeSellerConfig, pullHostedCredentials, type TenantCredentials } from "./tenant";
import { createUnderwriteClient, isAlreadyDone, type UnderwriteClient } from "./underwrite";
import { fiberIdempotencyKey, verifyWebhookSignature, webhookHeaders } from "./webhook";
import { eventNeedsCredentials, missingCredentials } from "./provisioning";

export type JobMemory = {
  brief?: PlanRequestEvent["brief"];
  constraints?: PlanRequestEvent["constraints"];
  event?: UnderwriteEvent;
  planPosted?: boolean;
  delivered?: boolean;
  lastType?: string;
};

export type SellerState = {
  jobs: Record<string, JobMemory>;
  credentials?: TenantCredentials;
  tenants?: string[];
  lastError?: string;
  lastErrorAt?: string;
};

export class SellerAgent extends Agent<Env, SellerState> {
  initialState: SellerState = { jobs: {}, tenants: [] };

  /** In-isolate lock so startFiber + waitUntil share one plan/deliver attempt. */
  private inFlight = new Map<string, Promise<void>>();

  private cfg(): SellerConfig {
    return mergeSellerConfig(this.env, this.state.credentials, this.name);
  }

  private client(): UnderwriteClient {
    const cfg = this.cfg();
    return createUnderwriteClient(cfg.underwriteBaseUrl, requireSellerKey(cfg));
  }

  /**
   * Pull hosted credentials when the DO is missing a seller key, HMAC, or BYOK.
   * Re-pulls when BYOK is absent so a prior pull that ignored nested `byok` can recover.
   */
  private async ensureCredentials(): Promise<SellerConfig> {
    const current = this.cfg();
    if (this.name === DIRECTORY_INSTANCE) return current;
    const tenant = this.state.credentials;
    if (tenant?.sellerApiKey && tenant?.webhookSecret && current.neuralakeApiKey) return current;
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
      const cfg = this.cfg();
      const missing = missingCredentials(cfg);
      return Response.json({
        ok: true,
        agent: "cloudflare-seller",
        instance: this.name,
        provisioned: Boolean(this.state.credentials?.sellerApiKey),
        has_seller_key: Boolean(cfg.sellerApiKey),
        has_webhook_secret: Boolean(cfg.webhookSecret),
        has_byok: Boolean(cfg.neuralakeApiKey),
        underwrite_base_url: cfg.underwriteBaseUrl,
        hosted_runtime_secret_configured: Boolean((this.env.UNDERWRITE_HOSTED_RUNTIME_SECRET ?? "").trim()),
        missing_credentials: missing,
        last_error: this.state.lastError ?? null,
        last_error_at: this.state.lastErrorAt ?? null,
      });
    }
    if (request.method === "PUT" && url.pathname === "/provision") {
      const body = (await request.json().catch(() => ({}))) as Parameters<typeof credentialsFromProvision>[0];
      const credentials = credentialsFromProvision(body);
      this.setState({ ...this.state, credentials: { ...this.state.credentials, ...credentials } });
      return Response.json({ ok: true, agent_id: this.name, provisioned: true, has_byok: Boolean(credentials.neuralakeApiKey) });
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

  /**
   * Durable accept: 202 as soon as the fiber row is stored (Underwrite timeout is 2.5s).
   * agents.startFiber() does **not** waitUntil the callback — after 202 the isolate can
   * freeze with the fiber still `pending`. Always attach processEvent to `ctx.waitUntil`.
   *
   * Exception: when the event needs credentials we do not have, we answer 503 instead of
   * 202. A 202 would tell Underwrite the webhook was delivered, and the invite would sit
   * unactionable forever with the rejection swallowed by `work.catch`. A non-2xx makes
   * Underwrite record `webhook_ok: false`, enqueue the payload in our inbox with the
   * error attached, and retry on the next inbox drain — so the job self-heals as soon as
   * the Durable Object is provisioned.
   */
  async acceptEvent(raw: unknown): Promise<Response> {
    const event = parseUnderwriteEvent(raw);
    if (!event) {
      return Response.json({ error: "unrecognized Underwrite event" }, { status: 400 });
    }

    this.setState(
      mergeJob(this.state, event.job_id, {
        event,
        lastType: event.type,
        brief: event.type === "plan_request" ? event.brief : this.state.jobs[event.job_id]?.brief,
        constraints: event.type === "plan_request" ? event.constraints : this.state.jobs[event.job_id]?.constraints,
      }),
    );

    // Skip the pre-flight for events the state machine would skip anyway, so a duplicate
    // delivery of finished work is never answered with a 503.
    const job = this.state.jobs[event.job_id];
    const alreadyDone =
      (event.type === "plan_request" && Boolean(job?.planPosted)) ||
      (event.type === "accepted" && Boolean(job?.delivered));

    if (!alreadyDone && eventNeedsCredentials(event)) {
      const cfg = await this.ensureCredentials();
      const missing = missingCredentials(cfg);
      if (missing.length > 0) {
        const error = `not provisioned: ${missing.join(", ")} missing — provision this agent Durable Object (or set the deprecated global env fallback)`;
        await this.reportLastError(error, { type: event.type, job_id: event.job_id });
        sellerError({ instance: this.name, msg: "accept_rejected_unprovisioned", type: event.type, job_id: event.job_id, missing });
        return Response.json(
          { ok: false, error, missing, instance: this.name, type: event.type, job_id: event.job_id },
          { status: 503 },
        );
      }
    }

    const work = this.processEventOnce(event);
    this.ctx.waitUntil(work.catch(() => {}));

    const receipt = await this.startFiber(
      `underwrite:${event.type}`,
      async (ctx) => {
        ctx.stash({ event } satisfies FiberSnapshot);
        if (ctx.signal.aborted) throw new Error("fiber aborted");
        await work;
      },
      {
        idempotencyKey: fiberIdempotencyKey(event.type, event.job_id),
        metadata: { type: event.type, job_id: event.job_id, event } satisfies FiberMetadata,
      },
    );

    sellerLog({
      instance: this.name,
      msg: "fiber_start",
      type: event.type,
      job_id: event.job_id,
      fiber_id: receipt.fiberId,
      accepted: receipt.accepted,
      fiber_status: receipt.status,
    });

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
    const metadata = ((ctx as { metadata?: FiberMetadata }).metadata ?? null) as FiberMetadata | null;
    const stored = metadata?.job_id ? this.state.jobs[metadata.job_id]?.event : undefined;
    const event = eventFromRecovery(snapshot, metadata, stored);
    if (!event) {
      const error = "missing underwrite fiber event on recovery";
      await this.reportLastError(error, { fiber_id: ctx.id, fiber_name: ctx.name });
      return { status: "error" as const, error };
    }
    try {
      await this.processEventOnce(event);
      return { status: "completed" as const, snapshot: { event } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "error" as const, error: message };
    }
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

  private processEventOnce(event: UnderwriteEvent): Promise<void> {
    const key = `${event.type}:${event.job_id}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      sellerLog({ instance: this.name, msg: "fiber_work_join", type: event.type, job_id: event.job_id });
      return existing;
    }
    const run = this.runEventWork(event).finally(() => {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async runEventWork(event: UnderwriteEvent): Promise<void> {
    if (event.type === "plan_request" && this.state.jobs[event.job_id]?.planPosted) {
      sellerLog({ instance: this.name, msg: "fiber_work_skip", type: event.type, job_id: event.job_id, reason: "plan_posted" });
      return;
    }
    if (event.type === "accepted" && this.state.jobs[event.job_id]?.delivered) {
      sellerLog({ instance: this.name, msg: "fiber_work_skip", type: event.type, job_id: event.job_id, reason: "delivered" });
      return;
    }
    try {
      sellerLog({ instance: this.name, msg: "fiber_work_start", type: event.type, job_id: event.job_id });
      await this.ensureCredentials();
      await this.processEvent(event);
      sellerLog({ instance: this.name, msg: "fiber_work_done", type: event.type, job_id: event.job_id });
      await this.reportLastError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sellerError({
        instance: this.name,
        msg: "fiber_work_error",
        type: event.type,
        job_id: event.job_id,
        error: message,
      });
      await this.reportLastError(message, { type: event.type, job_id: event.job_id });
      throw error;
    }
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
        event,
        lastType: "plan_request",
      }),
    );
    const cfg = await this.ensureCredentials();
    sellerLog({
      instance: this.name,
      msg: "neuralake_plan_start",
      job_id: event.job_id,
      model: cfg.neuralakeModel,
      neuralake_base_url: cfg.neuralakeBaseUrl,
      has_seller: Boolean(cfg.sellerApiKey),
      has_byok: Boolean(cfg.neuralakeApiKey),
    });
    const plan = await draftPlanWithNeuralake({
      baseUrl: cfg.neuralakeBaseUrl,
      apiKey: requireNeuralakeKey(cfg),
      model: cfg.neuralakeModel,
      event,
      signal,
    });
    sellerLog({
      instance: this.name,
      msg: "neuralake_plan_ok",
      job_id: event.job_id,
      price_usd: plan.price_usd,
      promised_confidence: plan.promised_confidence,
      max_latency_s: plan.max_latency_s,
    });
    try {
      await this.client().postPlan(event.job_id, plan);
      sellerLog({ instance: this.name, msg: "plan_post_ok", job_id: event.job_id });
    } catch (error) {
      if (!isAlreadyDone(error, "plan")) {
        sellerError({
          instance: this.name,
          msg: "plan_post_error",
          job_id: event.job_id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      sellerLog({ instance: this.name, msg: "plan_post_ok", job_id: event.job_id, already: true });
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
    const cfg = await this.ensureCredentials();
    sellerLog({
      instance: this.name,
      msg: "neuralake_execute_start",
      job_id: event.job_id,
      model: cfg.neuralakeModel,
      has_byok: Boolean(cfg.neuralakeApiKey),
    });
    const deliverable = await runAcceptedJob({
      baseUrl: cfg.neuralakeBaseUrl,
      apiKey: requireNeuralakeKey(cfg),
      model: cfg.neuralakeModel,
      brief,
      accepted: event,
      category: remembered?.constraints?.category ?? event.constraints?.category,
      signal,
    });
    try {
      await this.client().postDeliverable(event.job_id, deliverable);
      sellerLog({ instance: this.name, msg: "deliverable_post_ok", job_id: event.job_id });
    } catch (error) {
      if (!isAlreadyDone(error, "deliverable")) {
        sellerError({
          instance: this.name,
          msg: "deliverable_post_error",
          job_id: event.job_id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      sellerLog({ instance: this.name, msg: "deliverable_post_ok", job_id: event.job_id, already: true });
    }
    this.setState(mergeJob(this.state, event.job_id, { delivered: true, lastType: "accepted" }));
  }

  private async reportLastError(message: string | null, extra: Record<string, unknown> = {}): Promise<void> {
    if (message) {
      this.setState({ ...this.state, lastError: message, lastErrorAt: new Date().toISOString() });
      sellerError({ instance: this.name, msg: "last_error", error: message, ...extra });
    } else if (this.state.lastError) {
      this.setState({ ...this.state, lastError: undefined, lastErrorAt: undefined });
    } else {
      return;
    }

    const secret = (this.env.UNDERWRITE_HOSTED_RUNTIME_SECRET ?? "").trim();
    const base = resolveUnderwriteBaseUrl(this.env.UNDERWRITE_BASE_URL);
    if (!secret) {
      // The diagnostics channel depends on the same secret whose absence usually
      // causes the failure, so say out loud that the report was skipped.
      sellerError({
        instance: this.name,
        msg: "last_error_report_skipped",
        reason: "UNDERWRITE_HOSTED_RUNTIME_SECRET is unset on this Worker",
        underwrite_base_url: base,
      });
      return;
    }
    try {
      const res = await fetch(`${base}/api/internal/hosted-agents/${encodeURIComponent(this.name)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-underwrite-runtime-secret": secret,
        },
        body: JSON.stringify({ last_error: message, ...extra }),
      });
      if (!res.ok) {
        sellerError({ instance: this.name, msg: "last_error_report_failed", status: res.status });
      }
    } catch (error) {
      sellerError({
        instance: this.name,
        msg: "last_error_report_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
