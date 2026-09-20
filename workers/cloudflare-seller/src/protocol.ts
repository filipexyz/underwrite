/**
 * Wire shapes from Underwrite `src/lib/marketplace/push.ts` + `src/lib/contracts`.
 * Inbox types are only `plan_request` | `accepted` | `rejected`.
 */

export const INBOX_MESSAGE_TYPES = ["plan_request", "accepted", "rejected"] as const;
export type InboxMessageType = (typeof INBOX_MESSAGE_TYPES)[number];

export type BriefFile = {
  name: string;
  media_type: string;
  bytes?: number;
  content: string;
};

export type JobConstraints = {
  max_cost_usd: number;
  max_latency_s: number;
  min_confidence: number;
  category?: string;
};

export type PlanRequestEvent = {
  type: "plan_request";
  job_id: string;
  request_id: string;
  brief: {
    requirement: string;
    files: BriefFile[];
  };
  constraints: JobConstraints;
  plan_deadline_at: string;
};

export type AcceptedEvent = {
  type: "accepted";
  job_id: string;
  request_id: string;
  plan_id: string;
  execute: boolean;
  price_usd: number;
  promised_confidence: number;
  constraints?: JobConstraints;
};

export type RejectedEvent = {
  type: "rejected";
  job_id: string;
  request_id: string;
  plan_id: string | null;
  reason: string;
};

export type UnderwriteEvent = PlanRequestEvent | AcceptedEvent | RejectedEvent;

/** Seller POST /api/v1/jobs/{id}/plans — JobPlanInput */
export type JobPlanInput = {
  approach?: string;
  steps?: string | string[];
  price_usd: number;
  promised_confidence: number;
  max_latency_s: number;
  deliverable?: string;
  rationale?: string;
};

/** Winner POST /api/v1/jobs/{id}/deliverables — JobDeliverableInput */
export type JobDeliverableInput = {
  self_confidence?: number;
  artifact: {
    pdf_base64: string;
    kind?: "pdf";
    artifact_ref?: string;
    observed_latency_ms?: number;
    declared_latency_ms?: number;
    self_report?: number;
  };
};

export type InboxMessage = {
  inbox_id?: string;
  job_id?: string;
  request_id?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asFiles(value: unknown): BriefFile[] {
  if (!Array.isArray(value)) return [];
  const files: BriefFile[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const name = asString(row.name) ?? "input.html";
    const content = typeof row.content === "string" ? row.content : "";
    files.push({
      name,
      media_type: asString(row.media_type) ?? "text/html",
      bytes: asNumber(row.bytes),
      content,
    });
  }
  return files;
}

function asConstraints(value: unknown): JobConstraints | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const max_cost_usd = asNumber(row.max_cost_usd);
  const max_latency_s = asNumber(row.max_latency_s);
  const min_confidence = asNumber(row.min_confidence);
  if (max_cost_usd === undefined || max_latency_s === undefined || min_confidence === undefined) {
    return undefined;
  }
  return {
    max_cost_usd,
    max_latency_s,
    min_confidence,
    category: asString(row.category),
  };
}

export function jobIdOf(value: Record<string, unknown>): string | undefined {
  return asString(value.job_id) ?? asString(value.request_id);
}

/**
 * Accepts a raw webhook body or an inbox row (`{ type, job_id, payload }`).
 */
export function parseUnderwriteEvent(raw: unknown): UnderwriteEvent | null {
  const outer = asRecord(raw);
  if (!outer) return null;

  const inner = asRecord(outer.payload) ?? outer;
  const type = asString(outer.type) ?? asString(inner.type);
  const jobId = jobIdOf(outer) ?? jobIdOf(inner);
  if (!type || !jobId) return null;

  if (type === "plan_request") {
    const briefRow = asRecord(inner.brief) ?? asRecord(outer.brief);
    const requirement = asString(briefRow?.requirement);
    const constraints = asConstraints(inner.constraints) ?? asConstraints(outer.constraints);
    const deadline = asString(inner.plan_deadline_at) ?? asString(outer.plan_deadline_at);
    if (!requirement || !constraints || !deadline) return null;
    return {
      type: "plan_request",
      job_id: jobId,
      request_id: asString(inner.request_id) ?? asString(outer.request_id) ?? jobId,
      brief: { requirement, files: asFiles(briefRow?.files) },
      constraints,
      plan_deadline_at: deadline,
    };
  }

  if (type === "accepted") {
    const planId = asString(inner.plan_id) ?? asString(outer.plan_id);
    const price = asNumber(inner.price_usd) ?? asNumber(outer.price_usd);
    const confidence = asNumber(inner.promised_confidence) ?? asNumber(outer.promised_confidence);
    if (!planId || price === undefined || confidence === undefined) return null;
    return {
      type: "accepted",
      job_id: jobId,
      request_id: asString(inner.request_id) ?? asString(outer.request_id) ?? jobId,
      plan_id: planId,
      execute: inner.execute !== false && outer.execute !== false,
      price_usd: price,
      promised_confidence: confidence,
      constraints: asConstraints(inner.constraints) ?? asConstraints(outer.constraints),
    };
  }

  if (type === "rejected") {
    return {
      type: "rejected",
      job_id: jobId,
      request_id: asString(inner.request_id) ?? asString(outer.request_id) ?? jobId,
      plan_id: asString(inner.plan_id) ?? asString(outer.plan_id) ?? null,
      reason: asString(inner.reason) ?? asString(outer.reason) ?? "not selected (best-score)",
    };
  }

  return null;
}

export function isHtmlBriefFile(file: BriefFile): boolean {
  return /html/i.test(file.media_type) || /\.html?$/i.test(file.name);
}

export function briefHasHtmlFile(brief: PlanRequestEvent["brief"]): boolean {
  return brief.files.some((file) => isHtmlBriefFile(file) && Boolean(file.content.trim()));
}

export function sourceHtmlFromBrief(brief: PlanRequestEvent["brief"]): string | undefined {
  const htmlFile = brief.files.find((file) => isHtmlBriefFile(file) && file.content.trim());
  return htmlFile?.content;
}

export function htmlFromBrief(brief: PlanRequestEvent["brief"]): string {
  const html = sourceHtmlFromBrief(brief);
  if (html) return html;
  const any = brief.files.find((f) => f.content.trim());
  if (any?.content.trim()) {
    return `<!doctype html><html><body><pre>${escapeHtml(any.content)}</pre></body></html>`;
  }
  return `<!doctype html><html><body><h1>Underwrite job</h1><p>${escapeHtml(brief.requirement)}</p></body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
