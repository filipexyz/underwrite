"use server";

import { revalidatePath } from "next/cache";
import { issueApiKey, listApiKeys, revokeApiKey } from "@/lib/auth/api-keys";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AgentOwnerPatchInput, getOwnedAgent, parseSpecialties, patchOwnedAgent } from "@/lib/marketplace/sellers";

export type AgentFormState = { error?: string; secret?: string } | null;

function revalidateAgent(agentId: string) {
  revalidatePath("/agents");
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/account");
  revalidatePath("/keys");
  revalidatePath("/admin");
}

export async function updateOwnedAgent(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const { userId } = await requireSignedInPage();
  const agentId = String(formData.get("agent_id") ?? "").trim();
  if (!agentId) return { error: "missing agent" };
  const specialties = parseSpecialties(String(formData.get("specialties") ?? ""));
  const parsed = AgentOwnerPatchInput.safeParse({
    name: String(formData.get("name") ?? ""),
    specialties,
    model_family: String(formData.get("model_family") ?? ""),
    cost_ceiling_usd: Number(formData.get("cost_ceiling_usd")),
    webhook_url: String(formData.get("webhook_url") ?? ""),
    description: String(formData.get("description") ?? ""),
    contact: String(formData.get("contact") ?? ""),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? `${first.path.join(".")}: ${first.message}` : "invalid agent" };
  }
  const { db } = await getDb();
  const row = await patchOwnedAgent(db, agentId, userId, parsed.data);
  if (!row) return { error: "you do not own that agent" };
  revalidateAgent(agentId);
  return null;
}

export async function setOwnedAgentDisabled(formData: FormData): Promise<void> {
  const { userId } = await requireSignedInPage();
  const agentId = String(formData.get("agent_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!agentId || (status !== "disabled" && status !== "registered")) return;
  const { db } = await getDb();
  await patchOwnedAgent(db, agentId, userId, { status });
  revalidateAgent(agentId);
}

export async function mintOwnedSellerKey(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const { userId } = await requireSignedInPage();
  const agentId = String(formData.get("agent_id") ?? "").trim();
  const name = String(formData.get("name") ?? "seller").trim() || "seller";
  if (!agentId) return { error: "missing agent" };
  const { db } = await getDb();
  const agent = await getOwnedAgent(db, agentId, userId);
  if (!agent) return { error: "you do not own that agent" };
  const issued = await issueApiKey(db, {
    name,
    role: "seller",
    ownerClerkUserId: userId,
    agentId,
    scopes: ["agents:me"],
  });
  revalidateAgent(agentId);
  return { secret: issued.secret };
}

export async function revokeOwnedSellerKey(formData: FormData): Promise<void> {
  const { userId } = await requireSignedInPage();
  const agentId = String(formData.get("agent_id") ?? "").trim();
  const keyId = String(formData.get("id") ?? "").trim();
  if (!agentId || !keyId) return;
  const { db } = await getDb();
  const agent = await getOwnedAgent(db, agentId, userId);
  if (!agent) return;
  const owned = await listApiKeys(db, { ownerClerkUserId: userId, agentId });
  if (!owned.some((row) => row.id === keyId)) return;
  await revokeApiKey(db, keyId);
  revalidateAgent(agentId);
}
