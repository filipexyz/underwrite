/** Shared shapes + fixture helpers for the hosted-agent test area (safe for client). */

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
  last_error: string | null;
  last_error_at: string | null;
};

export const TEST_FIXTURE_SUMMARY = {
  requirement: "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
  max_cost_usd: 0.05,
  max_latency_s: 30,
  min_confidence: 0.95,
} as const;

export const HTML_TO_PDF_CATEGORY = "html_to_pdf";

export type TestFixtureSource = {
  specialties: string[];
  role?: string | null;
  name?: string | null;
  description?: string | null;
};

export function isHtmlToPdfCategory(category: string): boolean {
  return category.trim() === HTML_TO_PDF_CATEGORY;
}

export function executableSpecialties(specialties: string[]): string[] {
  return specialties.map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith("judge:"));
}

/** First executable specialty, or an explicit override. html_to_pdf is not auto-preferred. */
export function resolveTestCategory(specialties: string[], override?: string | null): string {
  const cleaned = (override ?? "").trim();
  if (cleaned) return cleaned;
  return executableSpecialties(specialties)[0] ?? HTML_TO_PDF_CATEGORY;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function articleFor(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

export function specialtyRequirement(source: TestFixtureSource, category: string): string {
  const role = source.role?.trim() || "executor";
  const name = source.name?.trim();
  const who = name ? `${name}, ${articleFor(role)} ${role}` : `${articleFor(role)} ${role}`;
  const desc = source.description?.trim().replace(/\s+/g, " ");
  const mission = desc
    ? desc.replace(/\.?$/, ".")
    : `Produce a concise briefing for this ${category} assignment.`;
  return `Act as ${who} specializing in ${category}. ${mission} Deliver an HTML briefing the buyer can verify: structured findings, risks, and a clear recommendation.`;
}

export function specialtyBriefHtml(source: TestFixtureSource, category: string): string {
  const role = source.role?.trim() || "executor";
  const name = source.name?.trim() || role;
  const title = escapeHtml(`${name} · ${category}`);
  const desc = source.description?.trim()
    ? `<p>${escapeHtml(source.description.trim())}</p>`
    : `<p>Prepare a structured briefing for this ${escapeHtml(category)} assignment.</p>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <h1>${title}</h1>
  <p>Role: ${escapeHtml(role)}. Specialty: ${escapeHtml(category)}.</p>
  ${desc}
  <h2>Deliverable</h2>
  <p>Produce a structured HTML briefing: findings, risks, and a recommendation the buyer can verify.</p>
  <p>Reference: <a href="https://example.com/underwrite/docs">Underwrite docs</a>.</p>
</body>
</html>`;
}

export function testTaskPreview(
  source: TestFixtureSource,
  override?: string | null,
): AgentTestFixture {
  const category = resolveTestCategory(source.specialties, override);
  if (isHtmlToPdfCategory(category)) {
    return {
      category,
      requirement: TEST_FIXTURE_SUMMARY.requirement,
      uses_html_to_pdf: true,
    };
  }
  return {
    category,
    requirement: specialtyRequirement(source, category),
    uses_html_to_pdf: false,
  };
}
