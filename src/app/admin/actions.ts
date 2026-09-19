"use server";

import { revalidatePath } from "next/cache";
import { listApiKeys, revokeApiKey } from "@/lib/auth/api-keys";
import { requireAdminPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { enableStatusFor, getAgentRow, setAgentStatus } from "@/lib/marketplace/sellers";

export async function disableAgent(formData: FormData): Promise<void> {
  await requireAdminPage();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const { db } = await getDb();
  await setAgentStatus(db, id, "disabled");
  revalidatePath("/admin");
  revalidatePath("/agents");
  revalidatePath("/account");
}

export async function enableAgent(formData: FormData): Promise<void> {
  await requireAdminPage();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const { db } = await getDb();
  const existing = await getAgentRow(db, id);
  if (!existing) return;
  await setAgentStatus(db, id, enableStatusFor(existing));
  revalidatePath("/admin");
  revalidatePath("/agents");
  revalidatePath("/account");
}

export async function revokeAnyKey(formData: FormData): Promise<void> {
  await requireAdminPage();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const { db } = await getDb();
  const rows = await listApiKeys(db);
  if (!rows.some((row) => row.id === id)) return;
  await revokeApiKey(db, id);
  revalidatePath("/admin");
  revalidatePath("/keys");
}
