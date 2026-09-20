/**
 * Self-serve seller registration. New agents sit alongside the seed catalog
 * (A/B/C1/C2/J1/J2). Disabled agents are hidden from hire by `loadRegistry`.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { AgentRole, LatencyClass, RiskTolerance } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { agents, trustAxes, wallets, type AgentRow, type AgentStatus } from "@/lib/db/schema";
import { issueApiKey, type PublicApiKey, toPublicApiKey } from "@/lib/auth/api-keys";
import { SELLER_SCOPES } from "@/lib/auth/scopes";
import { newId } from "@/lib/ids";
import {
  createAgentRuntime,
  getPublicAgentRuntime,
  hostedWebhookUrl,
  provisionHostedAgent,
  setRuntimeKind,
  type PublicAgentRuntime,
} from "./agent-runtime";
import { STARTING_AGENT_CREDITS_USD, ensureAgentWallet } from "./credits";
import type { AgentPolicy, QuotePolicy } from "./types";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const optionalSecret = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const AgentRegisterInput = z.object({
  name: z.string().trim().min(1).max(80),
  role: AgentRole,
  specialties: z.array(z.string().trim().min(1)).min(1),
  model_family: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80).default("auto"),
  baseline_confidence: z.number().min(0).max(1).default(0.9),
  cost_ceiling_usd: z.number().positive().max(10).default(0.05),
  latency_class: LatencyClass.default("mid"),
  risk_tolerance: RiskTolerance.default("mid"),
  contact: optionalText,
  webhook_url: optionalText,
  description: optionalText,
});
export type AgentRegisterInput = z.input<typeof AgentRegisterInput>;
export type AgentRegisterParsed = z.output<typeof AgentRegisterInput>;

/** Create-agent body: manifest plus hosted runtime / BYOK. */
export const AgentCreateInput = AgentRegisterInput.extend({
  /** Default: hosted unless a custom `webhook_url` is supplied. */
  hosted: z.boolean().optional(),
  byok_api_key: optionalSecret,
  byok_base_url: optionalText,
  byok_model: optionalText,
});
export type AgentCreateInput = z.input<typeof AgentCreateInput>;
export type AgentCreateParsed = z.output<typeof AgentCreateInput>;

export const AgentPatchInput = AgentRegisterInput.partial();
export type AgentPatchInput = z.infer<typeof AgentPatchInput>;

export const AgentOwnerPatchInput = AgentPatchInput.extend({
  status: z.enum(["disabled", "registered"]).optional(),
});
export type AgentOwnerPatchInput = z.infer<typeof AgentOwnerPatchInput>;

const noSelection = {
  policy: "cheapest" as const,
  check_history: false,
  floor_mode: "pass_through" as const,
};

export function parseSpecialties(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function defaultRegisteredPolicy(input: {
  role: AgentRole;
  specialties: string[];
  baseline_confidence: number;
  cost_ceiling_usd: number;
}): AgentPolicy {
  const specialty = input.specialties.find((s) => !s.startsWith("judge:")) ?? input.specialties[0] ?? "html_to_pdf";
  const promised = input.baseline_confidence;
  const cost = input.cost_ceiling_usd;

  if (input.role === "judge") {
    return {
      prime: null,
      sub: null,
      selection: noSelection,
      execution: null,
      judge: { tokens: { in: 3000, out: 200 } },
      planning_tokens: { in: 0, out: 0 },
    };
  }

  if (input.role === "delegator") {
    return {
      prime: {
        strategy: "outsource",
        promised_confidence: promised,
        own_latency_s: 3,
        own_cost_usd: Math.min(cost * 0.35, cost),
        subcontract_specialty: specialty,
        subtask: "underwrite the SLA and manage the chain",
      },
      sub: null,
      selection: { policy: "cheapest_trusted", check_history: true, floor_mode: "pass_through" },
      execution: null,
      judge: null,
      planning_tokens: { in: 1500, out: 300 },
    };
  }

  const hop: QuotePolicy = {
    strategy: "self",
    promised_confidence: promised,
    own_latency_s: input.role === "intermediary" ? 4 : 6,
    own_cost_usd: cost,
    subtask: "perform the requested work",
  };
  const sub: Record<string, QuotePolicy> = {};
  for (const item of input.specialties) {
    if (item.startsWith("judge:")) continue;
    sub[item] = { ...hop };
  }
  return {
    prime: hop,
    sub: Object.keys(sub).length > 0 ? sub : null,
    selection: noSelection,
    execution: {
      quality: "clean",
      latency_s: 8,
      latency_jitter: 0,
      self_report: promised,
      tokens: { in: 4000, out: 2500 },
    },
    judge: null,
    planning_tokens: { in: 800, out: 160 },
  };
}

export function toPublicAgent(row: AgentRow) {
  return {
    agent_id: row.agentId,
    name: row.name,
    role: row.role,
    status: row.status,
    specialties: row.specialties,
    model_family: row.modelFamily,
    model: row.model,
    baseline_confidence: row.baselineConfidence,
    cost_ceiling_usd: row.costCeilingUsd,
    latency_class: row.latencyClass,
    risk_tolerance: row.riskTolerance,
    contact: row.contact,
    webhook_url: row.webhookUrl,
    description: row.description,
    policy: row.policy,
    owner_user_id: row.ownerUserId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export type PublicOwnedAgent = ReturnType<typeof toPublicAgent> & {
  wallet_usd: number;
  runtime: PublicAgentRuntime;
};

export async function toOwnedAgentView(db: Db, row: AgentRow): Promise<PublicOwnedAgent> {
  const [wallet, runtime] = await Promise.all([
    ensureAgentWallet(db, row.agentId),
    getPublicAgentRuntime(db, row.agentId, row.webhookUrl),
  ]);
  return { ...toPublicAgent(row), wallet_usd: wallet.capitalUsd, runtime };
}

export async function listOwnedAgents(db: Db, ownerUserId: string): Promise<AgentRow[]> {
  return db.select().from(agents).where(eq(agents.ownerUserId, ownerUserId)).orderBy(desc(agents.createdAt));
}

export async function listAllAgents(db: Db): Promise<AgentRow[]> {
  return db.select().from(agents).orderBy(desc(agents.createdAt));
}

export async function getAgentRow(db: Db, agentId: string): Promise<AgentRow | null> {
  const [row] = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
  return row ?? null;
}

export function isOwnedBy(row: AgentRow, ownerUserId: string): boolean {
  return row.ownerUserId === ownerUserId;
}

/** Owner-only fetch. Returns null when the agent is missing or belongs to someone else. */
export async function getOwnedAgent(db: Db, agentId: string, ownerUserId: string): Promise<AgentRow | null> {
  const row = await getAgentRow(db, agentId);
  if (!row || !isOwnedBy(row, ownerUserId)) return null;
  return row;
}

export async function registerSellerAgent(
  db: Db,
  ownerUserId: string,
  draft: AgentCreateInput | AgentRegisterInput,
): Promise<{
  agent: AgentRow;
  secret: string;
  key: PublicApiKey;
  webhook_secret: string;
  runtime: PublicAgentRuntime;
}> {
  const input: AgentCreateParsed = AgentCreateInput.parse(draft);
  const agentId = newId("agt");
  const hosted = input.hosted ?? !input.webhook_url;
  const webhookUrl = hosted ? (hostedWebhookUrl(agentId) ?? input.webhook_url ?? null) : (input.webhook_url ?? null);
  const policy = defaultRegisteredPolicy(input);
  const [agent] = await db
    .insert(agents)
    .values({
      agentId,
      name: input.name,
      role: input.role,
      specialties: input.specialties,
      modelFamily: input.model_family,
      model: input.model,
      baselineConfidence: input.baseline_confidence,
      costCeilingUsd: input.cost_ceiling_usd,
      latencyClass: input.latency_class,
      riskTolerance: input.risk_tolerance,
      policy,
      status: "registered",
      ownerUserId,
      contact: input.contact ?? null,
      webhookUrl,
      description: input.description ?? null,
    })
    .returning();

  const [createdWallet] = await db
    .insert(wallets)
    .values({
      ownerId: agentId,
      capitalUsd: STARTING_AGENT_CREDITS_USD,
      riskTolerance: input.risk_tolerance,
    })
    .onConflictDoNothing()
    .returning();
  if (!createdWallet) {
    await ensureAgentWallet(db, agentId);
    await db
      .update(wallets)
      .set({ riskTolerance: input.risk_tolerance, updatedAt: new Date() })
      .where(eq(wallets.ownerId, agentId));
  }

  for (const specialty of input.specialties.filter((s) => !s.startsWith("judge:"))) {
    await db
      .insert(trustAxes)
      .values({
        agentId,
        category: specialty,
        execution: null,
        selection: null,
        underwriting: null,
        latency: null,
        costHonesty: null,
        judgment: null,
        samples: 0,
      })
      .onConflictDoNothing();
  }

  const issued = await issueApiKey(db, {
    name: `${input.name} seller key`,
    role: "seller",
    ownerUserId,
    agentId,
    // `SELLER_SCOPES`, not the stale `"agents:me"` this used to store: that string is not
    // in `API_SCOPES`, so it is inert for hashed keys today (scope checks only run on JWTs)
    // but would 403 every plan/deliverable call the moment seller auth moves to a JWT.
    scopes: [...SELLER_SCOPES],
  });

  const runtimeCreated = await createAgentRuntime(db, {
    agentId,
    kind: hosted ? "hosted" : "self_hosted",
    sellerApiKey: issued.secret,
    sellerKeyId: issued.row.id,
    byokApiKey: input.byok_api_key,
    byokBaseUrl: input.byok_base_url,
    byokModel: input.byok_model,
  });
  if (hosted) {
    await provisionHostedAgent(db, agentId);
  }
  const fresh = (await getAgentRow(db, agentId)) ?? agent;
  const runtime = await getPublicAgentRuntime(db, agentId, fresh.webhookUrl);

  return {
    agent: fresh,
    secret: issued.secret,
    key: toPublicApiKey(issued.row),
    webhook_secret: runtimeCreated.webhookSecret,
    runtime,
  };
}

export async function patchAgentProfile(
  db: Db,
  agentId: string,
  patch: AgentPatchInput,
): Promise<AgentRow | null> {
  const existing = await getAgentRow(db, agentId);
  if (!existing) return null;

  const nextSpecialties = patch.specialties ?? existing.specialties;
  const nextRole = (patch.role ?? existing.role) as AgentRole;
  const nextBaseline = patch.baseline_confidence ?? existing.baselineConfidence;
  const nextCost = patch.cost_ceiling_usd ?? existing.costCeilingUsd;

  const [row] = await db
    .update(agents)
    .set({
      name: patch.name ?? existing.name,
      role: nextRole,
      specialties: nextSpecialties,
      modelFamily: patch.model_family ?? existing.modelFamily,
      model: patch.model ?? existing.model,
      baselineConfidence: nextBaseline,
      costCeilingUsd: nextCost,
      latencyClass: patch.latency_class ?? existing.latencyClass,
      riskTolerance: patch.risk_tolerance ?? existing.riskTolerance,
      contact: patch.contact === undefined ? existing.contact : (patch.contact ?? null),
      webhookUrl: patch.webhook_url === undefined ? existing.webhookUrl : (patch.webhook_url ?? null),
      description: patch.description === undefined ? existing.description : (patch.description ?? null),
      policy:
        patch.role || patch.specialties || patch.baseline_confidence || patch.cost_ceiling_usd
          ? defaultRegisteredPolicy({
              role: nextRole,
              specialties: nextSpecialties,
              baseline_confidence: nextBaseline,
              cost_ceiling_usd: nextCost,
            })
          : existing.policy,
      updatedAt: new Date(),
    })
    .where(eq(agents.agentId, agentId))
    .returning();
  return row ?? null;
}

export function enableStatusFor(row: AgentRow): Exclude<AgentStatus, "disabled"> {
  return row.ownerUserId ? "registered" : "seed";
}

export async function setAgentStatus(db: Db, agentId: string, status: AgentStatus): Promise<AgentRow | null> {
  const [row] = await db
    .update(agents)
    .set({ status, updatedAt: new Date() })
    .where(eq(agents.agentId, agentId))
    .returning();
  return row ?? null;
}

/** Owner-only profile + enable/disable. Null when the caller does not own the agent. */
export async function patchOwnedAgent(
  db: Db,
  agentId: string,
  ownerUserId: string,
  patch: AgentOwnerPatchInput,
): Promise<AgentRow | null> {
  const existing = await getOwnedAgent(db, agentId, ownerUserId);
  if (!existing) return null;

  const { status, ...profile } = patch;
  const updated = await patchAgentProfile(db, agentId, profile);
  const row = updated ?? existing;
  if (profile.webhook_url !== undefined) {
    const hostedUrl = hostedWebhookUrl(agentId);
    const kind = profile.webhook_url && profile.webhook_url !== hostedUrl ? "self_hosted" : "hosted";
    await setRuntimeKind(db, agentId, kind, profile.webhook_url ?? null);
  }
  if (status === "disabled") return setAgentStatus(db, agentId, "disabled");
  if (status === "registered") return setAgentStatus(db, agentId, enableStatusFor(row));
  return (await getAgentRow(db, agentId)) ?? row;
}
