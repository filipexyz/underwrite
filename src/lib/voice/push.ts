/**
 * Voice composer → locked push marketplace (Cloudflare / webhook sellers).
 *
 * The seed Mastra loop (`runMarketplace` / `html-to-pdf-marketplace`) is the
 * demo PDF auction. Voice tasks must not take that path: after the brief is
 * filed they discover Top-K hireable agents for the classified specialty and
 * run the same push job as `POST /api/v1/requests` with `execution_mode: "push"`.
 *
 * No `invite_agent_ids` unless a test pins them. Default = discover Top-K for
 * `request.category`, **connected only** (hosted Cloudflare or self-hosted
 * webhook). Seed catalog agents without a webhook are not invited.
 */
import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { PushJobError, selectPlansIfReady, sleep, startPushJob } from "@/lib/marketplace/push";

const testJobs: Promise<void>[] = [];

/**
 * Start the push job, then wait the plan window and select — the same follow-up
 * `POST /api/v1/requests` schedules in `after()` for push mode.
 *
 * Empty Top-K is a hard stop (`no_eligible_plan` + ledger reason). There is no
 * seed/PDF fallback.
 */
export async function runVoicePushJob(requestId: string): Promise<void> {
  const { db } = await getDb();
  const started = await startPushJob(db, requestId, { requireWebhook: true });
  if (started.invited.length === 0) {
    console.error(
      `[voice] no connected agents for ${requestId}`,
      JSON.stringify({ skipped: started.skipped }),
    );
    return;
  }
  if (env.isTest) return;
  await sleep(env.planWindowMs);
  await selectPlansIfReady(db, requestId);
}

/**
 * Kick the push job after the HTTP/MCP response so the voice path stays fast.
 *
 * Tests call the handler outside Next's request context (`after()` would throw),
 * so the work is queued and `flushScheduledVoicePushJobs` waits for it.
 */
export function scheduleVoicePushJob(requestId: string): void {
  const work = () =>
    runVoicePushJob(requestId).catch((error) => {
      if (error instanceof PushJobError) {
        console.error(`[voice] push job ${requestId} failed: ${error.message}`, error.details);
        return;
      }
      console.error(`[voice] push job for ${requestId} crashed:`, error);
    });

  if (env.isTest) {
    testJobs.push(work());
    return;
  }
  after(work);
}

/** Test-only: wait for fire-and-forget push kickoffs from route handlers. */
export async function flushScheduledVoicePushJobs(): Promise<void> {
  while (testJobs.length > 0) {
    const pending = testJobs.splice(0);
    await Promise.all(pending);
  }
}
