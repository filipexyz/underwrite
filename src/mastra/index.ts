/**
 * Mastra instance: the marketplace workflow + env-gated observability.
 *
 * Storage stays in-memory (Mastra's default) — Neon is the system of record
 * for everything the product cares about; Mastra state is per-run plumbing.
 */
import { Mastra } from "@mastra/core/mastra";
import { ConsoleLogger } from "@mastra/core/logger";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { requests } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createObservability } from "@/lib/observability/mastra";
import { marketplaceWorkflow } from "./workflows/marketplace";

declare global {
  var __underwriteMastra: Mastra | undefined;
}

export function getMastra(): Mastra {
  if (!globalThis.__underwriteMastra) {
    globalThis.__underwriteMastra = new Mastra({
      workflows: { marketplaceWorkflow },
      observability: createObservability(),
      logger: new ConsoleLogger({ name: "underwrite", level: env.isTest ? "silent" : "warn" }),
    });
  }
  return globalThis.__underwriteMastra;
}

export type MarketplaceRunResult = Awaited<ReturnType<Awaited<ReturnType<typeof marketplaceWorkflow.createRun>>["start"]>>;

/** Runs the loop for one request to completion (used by the API via `after()`, scripts and tests). */
export async function runMarketplace(requestId: string): Promise<MarketplaceRunResult> {
  const mastra = getMastra();
  const workflow = mastra.getWorkflow("marketplaceWorkflow");
  const run = await workflow.createRun();

  const { db } = await getDb();
  await db.update(requests).set({ workflowRunId: run.runId, updatedAt: new Date() }).where(eq(requests.requestId, requestId));

  const outcome = await run.start({ inputData: { request_id: requestId } });
  if (outcome.status === "failed") {
    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    await db
      .update(requests)
      .set({ status: "failed", error: `workflow failed: ${message}`, updatedAt: new Date(), completedAt: new Date() })
      .where(eq(requests.requestId, requestId));
  }
  return outcome;
}
