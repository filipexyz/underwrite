import type { UnderwriteEvent } from "./protocol";
import { parseUnderwriteEvent } from "./protocol";

export type FiberSnapshot = {
  event?: UnderwriteEvent | unknown;
};

export type FiberMetadata = {
  type?: string;
  job_id?: string;
  event?: UnderwriteEvent | unknown;
};

/** Rebuild the webhook event after startFiber eviction — snapshot, metadata, then DO job memory. */
export function eventFromRecovery(
  snapshot: FiberSnapshot | null | undefined,
  metadata: FiberMetadata | null | undefined,
  stored: UnderwriteEvent | null | undefined,
): UnderwriteEvent | null {
  return asEvent(snapshot?.event) ?? asEvent(metadata?.event) ?? stored ?? null;
}

function asEvent(value: unknown): UnderwriteEvent | null {
  if (!value) return null;
  return parseUnderwriteEvent(value);
}

export function mergeJob<T extends { jobs: Record<string, J> }, J>(
  state: T,
  jobId: string,
  patch: Partial<J>,
): T {
  const current = state.jobs[jobId] ?? ({} as J);
  return { ...state, jobs: { ...state.jobs, [jobId]: { ...current, ...patch } } };
}
