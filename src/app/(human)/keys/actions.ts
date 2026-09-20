"use server";

import { revalidatePath } from "next/cache";
import { issueApiKey, listApiKeys, revokeApiKey } from "@/lib/auth/api-keys";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getAgentRow } from "@/lib/marketplace/sellers";

export type KeyFormState = { error?: string; secret?: string } | null;

export async function createBuyerKey(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  const { userId } = await requireSignedInPage();
  const name = String(formData.get("name") ?? "buyer").trim() || "buyer";
  const { db } = await getDb();
  const issued = await issueApiKey(db, {
    name,
    role: "buyer",
    ownerUserId: userId,
    scopes: ["requests"],
  });
  revalidatePath("/keys");
  return { secret: issued.secret };
}

export async function createSellerKey(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  const { userId } = await requireSignedInPage();
  const name = String(formData.get("name") ?? "seller").trim() || "seller";
  const agentId = String(formData.get("agent_id") ?? "").trim();
  if (!agentId) return { error: "pick an agent you own" };
  const { db } = await getDb();
  const agent = await getAgentRow(db, agentId);
  if (!agent || agent.ownerUserId !== userId) return { error: "you do not own that agent" };
  const issued = await issueApiKey(db, {
    name,
    role: "seller",
    ownerUserId: userId,
    agentId,
    scopes: ["agents:me"],
  });
  revalidatePath("/keys");
  revalidatePath(`/agents/${agentId}`);
  return { secret: issued.secret };
}

export async function revokeOwnKey(formData: FormData): Promise<void> {
  const { userId } = await requireSignedInPage();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const { db } = await getDb();
  const owned = await listApiKeys(db, { ownerUserId: userId });
  if (!owned.some((row) => row.id === id)) return;
  await revokeApiKey(db, id);
  revalidatePath("/keys");
  revalidatePath("/admin");
  revalidatePath("/agents");
}
