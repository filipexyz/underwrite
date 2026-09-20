/**
 * POST /api/v1/keys — an agent mints its own keys. No human, no console.
 *
 * This is the second half of provider self-onboarding:
 *   `POST /api/v1/agents` creates the record → `POST /api/v1/keys {role:"seller"}` mints the key
 *   that lets it post plans and deliverables.
 *
 * The secret is returned **once** and never stored in plaintext (only a hash), same as the console
 * flow. A seller key also creates the runtime row and returns the `whsec_…` webhook secret, because
 * a seller that cannot verify our signed `plan_request` webhook is a seller that will silently miss
 * every job it is invited to.
 *
 * Scopes are gated per role rather than on the endpoint, because asking for a buyer key should not
 * force an agent to also request `seller:register`:
 *   role=buyer  → requires `buyer:requests`
 *   role=seller → requires `seller:register` **and** an agent bound to this registration
 *
 * No `GET` yet. Listing keys needs a decision about what an unclaimed registration is allowed to
 * enumerate, and inventing that at 01:00 is how leaks happen. Minting is enough for onboarding.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { jsonError, requireRegistrationScope } from "@/lib/api/http";
import { issueApiKey, toPublicApiKey } from "@/lib/auth/api-keys";
import { BUYER_SCOPE, SELLER_REGISTER_SCOPE, SELLER_SCOPES } from "@/lib/auth/scopes";
import { agentRegistrations } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { ensureSellerKeyForAgent, hostedWebhookUrl } from "@/lib/marketplace/agent-runtime";
import { getAgentRow } from "@/lib/marketplace/sellers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateKeyInput = z.object({
  role: z.enum(["buyer", "seller"]),
  name: z.string().trim().min(1).max(80).optional(),
  /** Required for `seller`. Must be the agent this registration created. */
  agent_id: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "body must be JSON");
  }
  const parsed = CreateKeyInput.safeParse(body);
  if (!parsed.success) return jsonError(422, "invalid key request", parsed.error.flatten());
  const { role, name, agent_id: agentId } = parsed.data;

  const auth = await requireRegistrationScope(
    request,
    role === "seller" ? SELLER_REGISTER_SCOPE : BUYER_SCOPE,
  );
  if (!auth.ok) return auth.response;

  const { db } = await getDb();

  if (role === "buyer") {
    const issued = await issueApiKey(db, {
      name: name ?? "buyer key",
      role: "buyer",
      ownerUserId: auth.auth.ownerUserId ?? null,
      // A buyer key is not bound to a provider agent.
      agentId: null,
      scopes: [BUYER_SCOPE],
    });
    return NextResponse.json(
      {
        key: toPublicApiKey(issued.row),
        secret: issued.secret,
        warning: "copy this secret now — it is hashed at rest and cannot be shown again",
      },
      { status: 201 },
    );
  }

  // role === "seller"
  if (!agentId) return jsonError(422, "seller keys require agent_id");
  /*
   * Compare against the registration's bound agent in the database, not against `claims.agent_id`.
   * The token was minted before the agent existed, so its copy of the field is stale by construction
   * — and the database is the stronger source of truth anyway: this still only lets a registration
   * mint keys for the agent it actually created, which is the property that matters.
   */
  const [registration] = await db
    .select()
    .from(agentRegistrations)
    .where(eq(agentRegistrations.registrationId, auth.auth.registrationId))
    .limit(1);
  if (!registration) return jsonError(404, "registration not found");
  if (registration.status === "revoked") return jsonError(403, "registration was revoked");
  if (registration.agentId !== agentId) {
    return jsonError(403, "this registration is not bound to that agent", {
      bound_agent_id: registration.agentId ?? null,
    });
  }
  const agent = await getAgentRow(db, agentId);
  if (!agent) return jsonError(404, `agent not found: ${agentId}`);

  const issued = await issueApiKey(db, {
    name: name ?? `${agent.name} seller key`,
    role: "seller",
    ownerUserId: auth.auth.ownerUserId ?? null,
    agentId,
    scopes: [...SELLER_SCOPES],
  });
  const runtime = await ensureSellerKeyForAgent(db, {
    agentId,
    sellerApiKey: issued.secret,
    sellerKeyId: issued.row.id,
  });

  return NextResponse.json(
    {
      key: toPublicApiKey(issued.row),
      secret: issued.secret,
      agent_id: agentId,
      webhook_url: agent.webhookUrl ?? hostedWebhookUrl(agentId),
      webhook_secret: runtime.webhookSecret,
      runtime_provisioned: runtime.provisioned,
      hireable: agent.status === "registered",
      warning: "copy these now — both are hashed at rest and cannot be shown again",
      note:
        agent.status === "registered"
          ? "post plans to POST /api/v1/jobs/{job_id}/plans"
          : "the agent becomes hireable once a human completes the claim ceremony",
    },
    { status: 201 },
  );
}
