/**
 * Registry access: manifests + `trust_global` (per category) + `trust_pairwise`.
 * Discovery is by specialty — the manifest is what a hiring agent reads to
 * decide whether hiring is worth it (ARCHITECTURE.md §9).
 */
import { and, eq } from "drizzle-orm";
import type { AgentRole, AxisVector } from "@/lib/contracts";
import type { Db } from "@/lib/db/client";
import { agents, axesFromRow, trustAxes, trustPairwise, type AgentRow, type AgentStatus } from "@/lib/db/schema";

export type RegistryAgent = AgentRow & {
  axes: AxisVector;
  trust_global: number;
};

export type Registry = {
  category: string;
  agents: Map<string, RegistryAgent>;
  /** `${from}->${to}` → trust. Empty in the seeded catalog (D-022). */
  pairwise: Map<string, number>;
};

const TRUST_WEIGHTS: Array<[keyof AxisVector, number]> = [
  ["execution", 0.4],
  ["underwriting", 0.3],
  ["selection", 0.1],
  ["latency", 0.1],
  ["cost_honesty", 0.1],
  ["judgment", 0.4],
];

/**
 * Disabled agents are not invited to auctions and cannot be hired as subs.
 *
 * `pending_claim` is also not hireable: it is an agent that registered itself through auth.md and
 * whose human has not completed the claim ceremony yet. It must not consume an invite slot in
 * someone else's run — Top-K is finite, so an unclaimed provider would crowd out a real one.
 */
export function isHireableAgent(row: { status: AgentStatus | string }): boolean {
  return row.status === "seed" || row.status === "registered";
}

/** Weighted mean of the axes an agent actually has. Becomes the bid's `trust_global_snapshot`. */
export function trustGlobal(axes: AxisVector): number {
  let num = 0;
  let den = 0;
  for (const [axis, w] of TRUST_WEIGHTS) {
    const v = axes[axis];
    if (v === null || v === undefined) continue;
    num += v * w;
    den += w;
  }
  return den === 0 ? 0.5 : Math.round((num / den) * 1000) / 1000;
}

export async function loadRegistry(db: Db, category: string): Promise<Registry> {
  const [agentRows, axisRows, pairRows] = await Promise.all([
    db.select().from(agents),
    db.select().from(trustAxes).where(eq(trustAxes.category, category)),
    db.select().from(trustPairwise).where(eq(trustPairwise.category, category)),
  ]);

  const axesByAgent = new Map(axisRows.map((r) => [r.agentId, axesFromRow(r)]));
  const emptyAxes: AxisVector = {
    execution: null,
    selection: null,
    underwriting: null,
    latency: null,
    cost_honesty: null,
    judgment: null,
  };

  const map = new Map<string, RegistryAgent>();
  for (const row of agentRows) {
    if (!isHireableAgent(row)) continue;
    const axes = axesByAgent.get(row.agentId) ?? emptyAxes;
    map.set(row.agentId, { ...row, axes, trust_global: trustGlobal(axes) });
  }

  const pairwise = new Map<string, number>();
  for (const p of pairRows) pairwise.set(pairKey(p.fromAgentId, p.toAgentId), p.trust);

  return { category, agents: map, pairwise };
}

export function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function getAgent(registry: Registry, agentId: string): RegistryAgent {
  const agent = registry.agents.get(agentId);
  if (!agent) throw new Error(`agent not in registry: ${agentId}`);
  return agent;
}

export function discover(
  registry: Registry,
  opts: { specialty: string; exclude?: Iterable<string>; roles?: AgentRole[] },
): RegistryAgent[] {
  const exclude = new Set(opts.exclude ?? []);
  return [...registry.agents.values()]
    .filter((a) => isHireableAgent(a))
    .filter((a) => a.specialties.includes(opts.specialty))
    .filter((a) => !exclude.has(a.agentId))
    .filter((a) => (opts.roles ? opts.roles.includes(a.role as AgentRole) : a.role !== "judge"))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function judgesFor(registry: Registry, category: string): RegistryAgent[] {
  return [...registry.agents.values()]
    .filter((a) => a.role === "judge" && a.specialties.includes(`judge:${category}`))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export async function upsertPairwise(
  db: Db,
  args: { from: string; to: string; category: string; trust: number },
): Promise<void> {
  const existing = await db
    .select()
    .from(trustPairwise)
    .where(
      and(
        eq(trustPairwise.fromAgentId, args.from),
        eq(trustPairwise.toAgentId, args.to),
        eq(trustPairwise.category, args.category),
      ),
    );
  if (existing.length === 0) {
    await db.insert(trustPairwise).values({
      fromAgentId: args.from,
      toAgentId: args.to,
      category: args.category,
      trust: args.trust,
      samples: 1,
    });
  } else {
    await db
      .update(trustPairwise)
      .set({ trust: args.trust, samples: existing[0].samples + 1, updatedAt: new Date() })
      .where(
        and(
          eq(trustPairwise.fromAgentId, args.from),
          eq(trustPairwise.toAgentId, args.to),
          eq(trustPairwise.category, args.category),
        ),
      );
  }
}
