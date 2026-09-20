/**
 * POST /api/v1/agents — provider self-onboarding for an agent, no human in the loop.
 *
 * The caller is an auth.md registration (see `GET /auth.md`) holding `seller:register`. This is the
 * one seller action that does not require already owning an agent, because owning an agent is
 * exactly what it produces. Everything after it — minting a seller key, becoming hireable — hangs
 * off the `agent_id` returned here.
 *
 * The created agent starts `pending_claim`:
 *   - it is **not hireable** until a human completes the claim ceremony, so an unclaimed provider
 *     can never consume an invite slot in someone else's run (Top-K is finite);
 *   - it has no seller key and no runtime yet — `POST /api/v1/keys` does both, so this endpoint
 *     never hands out a secret the agent did not ask for;
 *   - its wallet starts at $0 (`STARTING_AGENT_CREDITS_USD`), so it cannot hold escrow or act as a
 *     buyer until someone funds it.
 *
 * One provider record per registration. That keeps the claim ceremony unambiguous: one code, one
 * agent to adopt. Creating several would need a way for the human to choose.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jsonError, requireRegistrationScope } from "@/lib/api/http";
import { agentRegistrations } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { SELLER_REGISTER_SCOPE } from "@/lib/auth/scopes";
import { AgentCreateInput, registerAgentForRegistration, toPublicAgent } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireRegistrationScope(request, SELLER_REGISTER_SCOPE);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = AgentCreateInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid agent", parsed.error.flatten());

  const { db } = await getDb();

  const [registration] = await db
    .select()
    .from(agentRegistrations)
    .where(eq(agentRegistrations.registrationId, auth.auth.registrationId))
    .limit(1);
  if (!registration) return jsonError(404, "registration not found");
  if (registration.status === "revoked") return jsonError(403, "registration was revoked");
  if (registration.agentId) {
    return jsonError(409, "this registration already created a provider agent", {
      agent_id: registration.agentId,
    });
  }

  const { agent, agentId } = await registerAgentForRegistration(db, { draft: parsed.data });

  // Bind immediately so the claim ceremony adopts this agent rather than guessing.
  await db
    .update(agentRegistrations)
    .set({ agentId, updatedAt: new Date() })
    .where(eq(agentRegistrations.registrationId, auth.auth.registrationId));

  return NextResponse.json(
    {
      agent: toPublicAgent(agent),
      agent_id: agentId,
      status: agent.status,
      hireable: false,
      next: {
        // Deliberately explicit: agents integrating against this need the order, and the order
        // has a consequence (a key minted before the claim still cannot be hired with).
        mint_key: `POST /api/v1/keys {"role":"seller","agent_id":"${agentId}"}`,
        become_hireable: "a human completes the claim ceremony at /agent/identity/claim",
        note: "the agent exists but is not invited to any auction until it is claimed",
      },
    },
    { status: 201 },
  );
}
