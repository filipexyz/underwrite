"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { seed } from "@/lib/db/seed";
import { env } from "@/lib/env";
import { createRequest, DEMO_REQUEST } from "@/lib/marketplace/requests";
import { runMarketplace } from "@/mastra";

/**
 * Fires the demo scene from the console. The human's only intervention is
 * this one: objective + budget. `request_received` carries `actor: "human"`;
 * everything after it is agents, so `human_interventions` stays 0.
 */
export async function fireDemoRequest(): Promise<void> {
  if (!env.modelProvider.enabled) {
    redirect("/console?error=model_provider");
  }
  const { db } = await getDb();
  const row = await createRequest(db, DEMO_REQUEST, { actor: "human", source: "console" });
  after(async () => {
    try {
      await runMarketplace(row.requestId);
    } catch (error) {
      console.error(`[underwrite] workflow for ${row.requestId} crashed:`, error);
    }
  });
  redirect(`/console/requests/${row.requestId}`);
}

/**
 * Trust is memory: after one run A no longer hires B and B no longer hires C1,
 * so the next request goes A → C2 on the first attempt. Resetting the catalog
 * (axes, wallets, pairwise trust — never the ledger) replays the scene.
 */
export async function resetCatalog(): Promise<void> {
  const { db } = await getDb();
  await seed(db);
  revalidatePath("/console");
}
