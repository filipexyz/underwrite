/**
 * The HTML → PDF marketplace loop as a Mastra workflow.
 *
 *   auction → contract → dountil( execute → verify → settle, settled ) → finalize
 *
 * Each step is a thin wrapper over an engine function: the engine writes
 * ledger events and state to Neon, Mastra gives us the run graph, tracing
 * spans (Langfuse / console when configured) and a restartable shape.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { RequestStatus } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import {
  contractChain,
  executeLeaf,
  finalizeRequest,
  runAuction,
  settleChain,
  verifyDelivery,
  type StepResult,
} from "@/lib/marketplace/engine";

const StepIO = z.object({
  request_id: z.string(),
  status: RequestStatus,
  settled: z.boolean(),
});

const WorkflowInput = z.object({ request_id: z.string() });

const WorkflowOutput = StepIO.extend({
  total_cost_usd: z.number(),
  human_interventions: z.number().int(),
});

type EngineFn = (db: Awaited<ReturnType<typeof getDb>>["db"], requestId: string) => Promise<StepResult>;

function engineStep(id: string, description: string, fn: EngineFn, input: z.ZodTypeAny = StepIO) {
  return createStep({
    id,
    description,
    inputSchema: input,
    outputSchema: StepIO,
    execute: async ({ inputData, writer }) => {
      const { db } = await getDb();
      const out = await fn(db, (inputData as { request_id: string }).request_id);
      await writer.write({ type: "underwrite.step", step: id, ...out });
      return out;
    },
  });
}

const auction = engineStep("auction", "One-round auction: bids, compliance, cheapest compliant wins", runAuction, WorkflowInput);
const contract = engineStep("contract", "Plans published and validated, hops hired, escrows locked", contractChain);
const execute = engineStep("execute", "Leaf hop produces the artifact", executeLeaf);
const verify = engineStep("verify", "Deterministic checks, independent judges, confidence", verifyDelivery);
const settle = engineStep("settle", "Escrow release/withhold, stakes, attribution, axes, escalation", settleChain);

const finalize = createStep({
  id: "finalize",
  description: "Derive metrics from the ledger and close the run",
  inputSchema: StepIO,
  outputSchema: WorkflowOutput,
  execute: async ({ inputData }) => {
    const { db } = await getDb();
    const out = await finalizeRequest(db, inputData.request_id);
    return {
      request_id: out.request_id,
      status: out.status,
      settled: out.settled,
      total_cost_usd: out.metrics.total_cost_usd,
      human_interventions: out.metrics.human_interventions,
    };
  },
});

/** execute → verify → settle, repeated while an escalation re-contracts the chain. */
const attempt = createWorkflow({
  id: "marketplace-attempt",
  inputSchema: StepIO,
  outputSchema: StepIO,
})
  .then(execute)
  .then(verify)
  .then(settle)
  .commit();

export const marketplaceWorkflow = createWorkflow({
  id: "html-to-pdf-marketplace",
  description: "Buyer request → auction → contract → execute → verify → settle (escalate within budget) → certificate",
  inputSchema: WorkflowInput,
  outputSchema: WorkflowOutput,
})
  .then(auction)
  .then(contract)
  .dountil(attempt, async ({ inputData }) => inputData.settled)
  .then(finalize)
  .commit();
