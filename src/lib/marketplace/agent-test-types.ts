/** Shared shapes for the hosted-agent test area (safe for client components). */

export type ReadinessSeverity = "block" | "warn" | "info";

export type ReadinessCheck = {
  id: string;
  ok: boolean;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
};

export type WorkerHealthProbe = {
  reachable: boolean;
  underwrite_base_url: string | null;
  localhost_callback: boolean;
  hosted_runtime_secret_configured: boolean | null;
  error: string | null;
};

export type LastRuntimeError = {
  source: "webhook" | "worker" | "platform";
  message: string;
  at: string | null;
};

export type AgentTestFixture = {
  category: string;
  requirement: string;
  uses_html_to_pdf: boolean;
};

export type AgentTestReadiness = {
  ready: boolean;
  checks: ReadinessCheck[];
  worker: WorkerHealthProbe;
  last_error: LastRuntimeError | null;
  hosted_seller_base_url: string | null;
  platform_underwrite_base_url: string;
  model_provider_message: string | null;
  fixture: AgentTestFixture;
};

export type RecentAgentTest = {
  request_id: string;
  status: string;
  created_at: string;
  invited: boolean;
};

export type PublicTestRuntime = {
  kind: string;
  webhook_url: string | null;
  webhook_secret_configured: boolean;
  byok_configured: boolean;
  byok_base_url: string | null;
  byok_model: string | null;
  provisioned: boolean;
  hosted_webhook_url: string | null;
};

export const TEST_FIXTURE_SUMMARY = {
  requirement: "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
  max_cost_usd: 0.05,
  max_latency_s: 30,
  min_confidence: 0.95,
} as const;

export const HTML_TO_PDF_CATEGORY = "html_to_pdf";
