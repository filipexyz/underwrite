/**
 * Hosted-agent test area: diagnose a seller runtime and open a real push job
 * as the owning user, targeting that agent via `invite_agent_ids`.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { FailurePolicy, RequestTask } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { agentInbox, requests, type AgentRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { MODEL_PROVIDER_REQUIRED_MESSAGE } from "@/lib/observability/inference";
import type { PublicAgentRuntime } from "./agent-runtime";
import {
  HTML_TO_PDF_CATEGORY,
  type AgentTestFixture,
  type AgentTestReadiness,
  type LastRuntimeError,
  type ReadinessCheck,
  type ReadinessSeverity,
  type RecentAgentTest,
  type WorkerHealthProbe,
} from "./agent-test-types";
import { ensureUserWallet } from "./credits";
import { createRequest, DEFAULT_CATEGORY, DEMO_REQUEST, getRequest } from "./requests";
import { getOwnedAgent, listOwnedAgents } from "./sellers";
import { PushJobError, startPushJob, type InviteDelivery, type InviteSkip } from "./push";

export type {
  AgentTestFixture,
  AgentTestReadiness,
  LastRuntimeError,
  ReadinessCheck,
  ReadinessSeverity,
  RecentAgentTest,
  WorkerHealthProbe,
} from "./agent-test-types";

export class AgentTestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentTestError";
  }
}

export const AgentTestInput = z.object({
  task: RequestTask.optional(),
  max_cost_usd: z.number().positive().max(10).optional(),
  max_latency_s: z.number().positive().max(120).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  failure_policy: FailurePolicy.optional(),
  /** Override the invite/fixture specialty. Must be one of the agent’s specialties. */
  category: z.string().trim().min(1).max(80).optional(),
});
export type AgentTestInput = z.infer<typeof AgentTestInput>;

export function executableSpecialties(specialties: string[]): string[] {
  return specialties.map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith("judge:"));
}

/** Prefer html_to_pdf when listed; otherwise the first executable specialty. */
export function resolveTestCategory(specialties: string[], override?: string | null): string {
  const cleaned = (override ?? "").trim();
  if (cleaned) return cleaned;
  const executable = executableSpecialties(specialties);
  if (executable.includes(DEFAULT_CATEGORY)) return DEFAULT_CATEGORY;
  return executable[0] ?? DEFAULT_CATEGORY;
}

export function testTaskForCategory(category: string) {
  if (category === DEFAULT_CATEGORY || category === HTML_TO_PDF_CATEGORY) {
    return DEMO_REQUEST.task;
  }
  return {
    requirement: `Complete a ${category} task from the attached brief. Produce a structured written result the buyer can verify.`,
    files: [
      {
        name: "brief.txt",
        media_type: "text/plain" as const,
        content: `Specialty: ${category}\nProduce a concise, structured deliverable matching this specialty.`,
      },
    ],
  };
}

export function testFixtureForAgent(specialties: string[], override?: string | null): AgentTestFixture {
  const category = resolveTestCategory(specialties, override);
  const task = testTaskForCategory(category);
  return {
    category,
    requirement: task.requirement,
    uses_html_to_pdf: category === DEFAULT_CATEGORY,
  };
}

export function isLoopbackHost(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(value);
  }
}

export function looksRemoteOrigin(value: string | null | undefined): boolean {
  return Boolean(value) && !isLoopbackHost(value);
}

export async function probeHostedSeller(baseUrl: string | undefined): Promise<WorkerHealthProbe> {
  if (!baseUrl) {
    return {
      reachable: false,
      underwrite_base_url: null,
      localhost_callback: false,
      hosted_runtime_secret_configured: null,
      error: "HOSTED_SELLER_BASE_URL is unset",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const res = await fetch(`${baseUrl}/health`, { method: "GET", signal: controller.signal, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as {
      underwrite_base_url?: string;
      hosted_runtime_secret_configured?: boolean;
    } | null;
    const callback = typeof body?.underwrite_base_url === "string" ? body.underwrite_base_url : null;
    if (!res.ok) {
      return {
        reachable: false,
        underwrite_base_url: callback,
        localhost_callback: isLoopbackHost(callback),
        hosted_runtime_secret_configured: body?.hosted_runtime_secret_configured ?? null,
        error: `http ${res.status}`,
      };
    }
    return {
      reachable: true,
      underwrite_base_url: callback,
      localhost_callback: isLoopbackHost(callback),
      hosted_runtime_secret_configured: body?.hosted_runtime_secret_configured ?? null,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      reachable: false,
      underwrite_base_url: null,
      localhost_callback: false,
      hosted_runtime_secret_configured: null,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function lastInboxWebhookError(db: Db, agentId: string): Promise<LastRuntimeError | null> {
  const rows = await db
    .select()
    .from(agentInbox)
    .where(eq(agentInbox.agentId, agentId))
    .orderBy(desc(agentInbox.createdAt))
    .limit(20);
  for (const row of rows) {
    const webhookError = row.payload.webhook_error;
    if (typeof webhookError === "string" && webhookError.length > 0) {
      return { source: "webhook", message: webhookError, at: row.createdAt.toISOString() };
    }
  }
  return null;
}

function check(
  id: string,
  ok: boolean,
  severity: ReadinessSeverity,
  title: string,
  detail: string,
): ReadinessCheck {
  return { id, ok, severity, title, detail };
}

export async function diagnoseAgentTest(
  db: Db,
  agent: AgentRow,
  runtime: PublicAgentRuntime,
  userId: string,
): Promise<AgentTestReadiness> {
  const [wallet, worker, webhookError] = await Promise.all([
    ensureUserWallet(db, userId),
    probeHostedSeller(env.hostedSellerBaseUrl),
    lastInboxWebhookError(db, agent.agentId),
  ]);

  const hostedBase = env.hostedSellerBaseUrl ?? null;
  const platformCallback = env.publicBaseUrl;
  const providerOk = env.modelProvider.enabled;
  const fixture = testFixtureForAgent(agent.specialties);
  const executable = executableSpecialties(agent.specialties);
  const htmlFixtureOk = executable.length > 0 && fixture.uses_html_to_pdf;
  const enabled = agent.status !== "disabled";
  const funded = wallet.capitalUsd >= DEMO_REQUEST.max_cost_usd;
  const localhostMismatch =
    (worker.localhost_callback && looksRemoteOrigin(hostedBase)) ||
    (isLoopbackHost(platformCallback) && looksRemoteOrigin(hostedBase));

  const checks: ReadinessCheck[] = [
    check(
      "model_provider",
      providerOk,
      "block",
      "NeuraLake / model provider",
      providerOk
        ? `${env.modelProvider.name} · ${env.modelProvider.model}`
        : MODEL_PROVIDER_REQUIRED_MESSAGE,
    ),
    check(
      "agent_enabled",
      enabled,
      "block",
      "Agent enabled",
      enabled ? "Hireable — marketplace can invite this agent." : "Disabled agents are omitted from invites. Enable the agent first.",
    ),
    check(
      "specialty",
      htmlFixtureOk,
      executable.length === 0 ? "block" : fixture.uses_html_to_pdf ? "info" : "warn",
      fixture.uses_html_to_pdf ? "Specialty html_to_pdf" : `Fixture specialty ${fixture.category}`,
      executable.length === 0
        ? "This agent has no executable specialty. Add one on the agent page (html_to_pdf for the PDF demo)."
        : fixture.uses_html_to_pdf
          ? "Matches the marketplace category used by the HTML→PDF test fixture."
          : `This agent does not list html_to_pdf (${agent.specialties.join(", ") || "—"}). The test job will invite it as ${fixture.category} instead of dropping it. Add html_to_pdf on the agent page to use the PDF fixture.`,
    ),
    check(
      "wallet",
      funded,
      "block",
      "Buyer wallet",
      funded
        ? `$${wallet.capitalUsd.toFixed(2)} test credits (needs ≥ $${DEMO_REQUEST.max_cost_usd.toFixed(2)}).`
        : `Insufficient balance ($${wallet.capitalUsd.toFixed(2)}). User wallets start at $1000 on first sign-in.`,
    ),
    check(
      "hosted_seller_base_url",
      Boolean(hostedBase),
      "warn",
      "HOSTED_SELLER_BASE_URL",
      hostedBase
        ? hostedBase
        : "Unset. Hosted webhook URL cannot be minted; invites fall back to inbox until an admin sets the Worker origin.",
    ),
    check(
      "worker_health",
      worker.reachable,
      "warn",
      "Cloudflare Worker /health",
      worker.reachable
        ? `Reachable. Worker UNDERWRITE_BASE_URL=${worker.underwrite_base_url ?? "—"}.`
        : worker.error ?? "Worker health probe failed.",
    ),
    check(
      "worker_callback",
      !localhostMismatch,
      "warn",
      "Worker callback origin",
      localhostMismatch
        ? `Worker or platform UNDERWRITE_BASE_URL is still localhost (${worker.underwrite_base_url ?? platformCallback}). A remote Worker cannot post plans back to 127.0.0.1.`
        : `Platform ${platformCallback}${worker.underwrite_base_url ? ` · Worker ${worker.underwrite_base_url}` : ""}.`,
    ),
    check(
      "byok",
      runtime.byok_configured,
      "warn",
      "Agent BYOK",
      runtime.byok_configured
        ? `Configured${runtime.byok_model ? ` · ${runtime.byok_model}` : ""}.`
        : "No per-agent NeuraLake key. The Worker cannot plan or render unless a deprecated global NEURALAKE_API_KEY is set.",
    ),
    check(
      "provisioned",
      runtime.provisioned,
      "warn",
      "Durable Object provisioned",
      runtime.provisioned
        ? "Credentials were pushed to the Worker."
        : "Not provisioned yet. First webhook or Save runtime → re-provision pushes secrets; the Worker can also pull GET /api/internal/hosted-agents/:id.",
    ),
    check(
      "webhook_url",
      Boolean(runtime.webhook_url),
      "warn",
      "Webhook URL",
      runtime.webhook_url ?? "None — this agent only receives inbox plan_request messages.",
    ),
    check(
      "webhook_secret",
      runtime.webhook_secret_configured,
      "info",
      "HMAC secret",
      runtime.webhook_secret_configured ? "Per-agent whsec_ configured." : "Using the platform fallback secret.",
    ),
  ];

  const runtimeError = runtime.last_error
    ? { source: "worker" as const, message: runtime.last_error, at: runtime.last_error_at }
    : null;
  const last_error =
    runtimeError ??
    webhookError ??
    (!worker.reachable && hostedBase
      ? { source: "worker" as const, message: worker.error ?? "Worker unreachable", at: null }
      : localhostMismatch
        ? {
            source: "platform" as const,
            message: "UNDERWRITE_BASE_URL is still localhost while the hosted Worker is remote.",
            at: null,
          }
        : null);

  return {
    ready: checks.filter((c) => c.severity === "block").every((c) => c.ok),
    checks,
    worker,
    last_error,
    hosted_seller_base_url: hostedBase,
    platform_underwrite_base_url: platformCallback,
    model_provider_message: providerOk ? null : MODEL_PROVIDER_REQUIRED_MESSAGE,
    fixture,
  };
}

export async function listRecentAgentTests(db: Db, userId: string, agentId: string, limit = 8): Promise<RecentAgentTest[]> {
  const rows = await db
    .select()
    .from(requests)
    .where(eq(requests.buyerWalletId, userId))
    .orderBy(desc(requests.createdAt))
    .limit(40);
  return rows
    .filter((row) => {
      const invited = row.state?.invited_agent_ids ?? [];
      const requested = row.state?.requested_invite_agent_ids ?? [];
      return invited.includes(agentId) || requested.includes(agentId);
    })
    .slice(0, limit)
    .map((row) => ({
      request_id: row.requestId,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      invited: (row.state?.invited_agent_ids ?? []).includes(agentId),
    }));
}

export async function startOwnedAgentTest(
  db: Db,
  ownerUserId: string,
  agentId: string,
  input: AgentTestInput = {},
): Promise<{
  request_id: string;
  status: string;
  execution_mode: "push";
  invited_agent_ids: string[];
  requested_invite_agent_ids: string[];
  deliveries: InviteDelivery[];
  skipped: InviteSkip[];
  plan_deadline_at: string;
  targeted: boolean;
  category: string;
  links: { console: string; events: string };
}> {
  const agent = await getOwnedAgent(db, agentId, ownerUserId);
  if (!agent) throw new AgentTestError(404, `agent not found: ${agentId}`);
  if (agent.status === "disabled") {
    throw new AgentTestError(409, "agent is disabled — enable it before running a test job");
  }
  const category = resolveTestCategory(agent.specialties, input.category);
  if (input.category && !agent.specialties.includes(category)) {
    throw new AgentTestError(422, `category ${category} is not one of this agent’s specialties`, {
      specialties: agent.specialties,
    });
  }
  if (executableSpecialties(agent.specialties).length === 0) {
    throw new AgentTestError(422, "agent has no executable specialty — add one on the agent page", {
      specialties: agent.specialties,
    });
  }
  if (!env.modelProvider.enabled) {
    throw new AgentTestError(503, MODEL_PROVIDER_REQUIRED_MESSAGE);
  }

  const maxCost = input.max_cost_usd ?? DEMO_REQUEST.max_cost_usd;
  const wallet = await ensureUserWallet(db, ownerUserId);
  if (wallet.capitalUsd < maxCost) {
    throw new AgentTestError(402, "insufficient wallet balance", {
      owner_id: wallet.ownerId,
      balance_usd: wallet.capitalUsd,
      required_usd: maxCost,
    });
  }

  const row = await createRequest(
    db,
    {
      task: input.task ?? testTaskForCategory(category),
      max_cost_usd: maxCost,
      max_latency_s: input.max_latency_s ?? DEMO_REQUEST.max_latency_s,
      min_confidence: input.min_confidence ?? DEMO_REQUEST.min_confidence,
      failure_policy: input.failure_policy ?? DEMO_REQUEST.failure_policy,
      selection_timeout_s: DEMO_REQUEST.selection_timeout_s,
      execution_mode: "push",
      invite_agent_ids: [agent.agentId],
    },
    {
      actor: "human",
      source: "agent-test-area",
      buyerWalletId: ownerUserId,
      executionMode: "push",
      category,
    },
  );

  try {
    const started = await startPushJob(db, row.requestId);
    const current = await getRequest(db, row.requestId);
    return {
      request_id: row.requestId,
      status: current?.status ?? "planning",
      execution_mode: "push",
      invited_agent_ids: started.invited,
      requested_invite_agent_ids: [agent.agentId],
      deliveries: started.deliveries,
      skipped: started.skipped,
      plan_deadline_at: started.plan_deadline_at,
      targeted: started.invited.includes(agent.agentId),
      category,
      links: {
        console: `/console/requests/${row.requestId}`,
        events: `/console/requests/${row.requestId}/events`,
      },
    };
  } catch (error) {
    if (error instanceof PushJobError) {
      throw new AgentTestError(error.status, error.message, error.details);
    }
    throw error;
  }
}

export async function loadOwnedAgentOptions(db: Db, ownerUserId: string) {
  const rows = await listOwnedAgents(db, ownerUserId);
  return rows.map((row) => ({
    agent_id: row.agentId,
    name: row.name,
    status: row.status,
    specialties: row.specialties,
  }));
}

export { DEMO_REQUEST, DEFAULT_CATEGORY };
