import type { JobDeliverableInput, JobPlanInput } from "./protocol";

export class UnderwriteApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} → ${status}`);
    this.name = "UnderwriteApiError";
    this.status = status;
    this.body = body;
  }
}

export type UnderwriteClient = {
  getMe: () => Promise<{ agent?: { agent_id?: string; webhook_url?: string | null } }>;
  patchMe: (body: Record<string, unknown>) => Promise<unknown>;
  listInbox: (opts?: { unread?: boolean; markRead?: boolean }) => Promise<{
    agent_id?: string;
    messages: unknown[];
  }>;
  postPlan: (jobId: string, plan: JobPlanInput) => Promise<unknown>;
  postDeliverable: (jobId: string, deliverable: JobDeliverableInput) => Promise<unknown>;
};

function sellerHeaders(apiKey: string, json: boolean): HeadersInit {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
  if (json) headers["content-type"] = "application/json";
  return headers;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createUnderwriteClient(baseUrl: string, apiKey: string): UnderwriteClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function api(path: string, init: RequestInit = {}): Promise<unknown> {
    const method = init.method ?? "GET";
    const res = await fetch(`${root}${path}`, {
      ...init,
      headers: {
        ...sellerHeaders(apiKey, Boolean(init.body)),
        ...(init.headers ?? {}),
      },
    });
    const body = await readBody(res);
    console.log(
      JSON.stringify({
        service: "cloudflare-seller",
        ts: new Date().toISOString(),
        msg: "underwrite_api",
        method,
        path,
        status: res.status,
        ok: res.ok,
      }),
    );
    if (!res.ok) throw new UnderwriteApiError(method, path, res.status, body);
    return body;
  }

  return {
    getMe: async () => (await api("/api/v1/agents/me")) as { agent?: { agent_id?: string; webhook_url?: string | null } },
    patchMe: (body) => api("/api/v1/agents/me", { method: "PATCH", body: JSON.stringify(body) }),
    listInbox: async (opts) => {
      const query = new URLSearchParams();
      if (opts?.unread) query.set("unread", "1");
      if (opts?.markRead) query.set("mark_read", "1");
      const suffix = query.size ? `?${query}` : "";
      return (await api(`/api/v1/agents/me/inbox${suffix}`)) as { agent_id?: string; messages: unknown[] };
    },
    postPlan: (jobId, plan) =>
      api(`/api/v1/jobs/${encodeURIComponent(jobId)}/plans`, {
        method: "POST",
        body: JSON.stringify(plan),
      }),
    postDeliverable: (jobId, deliverable) =>
      api(`/api/v1/jobs/${encodeURIComponent(jobId)}/deliverables`, {
        method: "POST",
        body: JSON.stringify(deliverable),
      }),
  };
}

export function isAlreadyDone(error: unknown, kind: "plan" | "deliverable"): boolean {
  if (!(error instanceof UnderwriteApiError) || error.status !== 409) return false;
  const message = typeof error.body === "object" && error.body && "error" in error.body
    ? String((error.body as { error: unknown }).error)
    : error.message;
  if (kind === "plan") return /one plan per agent/i.test(message);
  return /already/i.test(message);
}
