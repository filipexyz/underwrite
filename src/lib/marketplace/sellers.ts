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
import { newId } from "@/lib/ids";
import { ensureAgentWallet } from "./credits";
import type { AgentPolicy, QuotePolicy } from "./types";

const optionalText = z
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
});
export type AgentRegisterInput = z.input<typeof AgentRegisterInput>;
export type AgentRegisterParsed = z.output<typeof AgentRegisterInput>;

export const AgentPatchInput = AgentRegisterInput.partial();
export type AgentPatchInput = z.infer<typeof AgentPatchInput>;

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
    policy: row.policy,
    owner_clerk_user_id: row.ownerClerkUserId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listOwnedAgents(db: Db, ownerClerkUserId: string): Promise<AgentRow[]> {
  return db.select().from(agents).where(eq(agents.ownerClerkUserId, ownerClerkUserId)).orderBy(desc(agents.createdAt));
}

export async function listAllAgents(db: Db): Promise<AgentRow[]> {
  return db.select().from(agents).orderBy(desc(agents.createdAt));
}

export async function getAgentRow(db: Db, agentId: string): Promise<AgentRow | null> {
  const [row] = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
  return row ?? null;
}

export async function registerSellerAgent(
  db: Db,
  ownerClerkUserId: string,
  draft: AgentRegisterInput,
): Promise<{ agent: AgentRow; secret: string; key: PublicApiKey }> {
  const input: AgentRegisterParsed = AgentRegisterInput.parse(draft);
  const agentId = newId("agt");
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
      ownerClerkUserId,
      contact: input.contact ?? null,
      webhookUrl: input.webhook_url ?? null,
    })
    .returning();

  await ensureAgentWallet(db, agentId);
  await db
    .update(wallets)
    .set({ riskTolerance: input.risk_tolerance, updatedAt: new Date() })
    .where(eq(wallets.ownerId, agentId));

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
    ownerClerkUserId,
    agentId,
    scopes: ["agents:me"],
  });

  return { agent, secret: issued.secret, key: toPublicApiKey(issued.row) };
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
  return row.ownerClerkUserId ? "registered" : "seed";
}

export async function setAgentStatus(db: Db, agentId: string, status: AgentStatus): Promise<AgentRow | null> {
  const [row] = await db
    .update(agents)
    .set({ status, updatedAt: new Date() })
    .where(eq(agents.agentId, agentId))
    .returning();
  return row ?? null;
}
