/**
 * Artifacts for the HTML → PDF vertical.
 *
 * The leaf hop produces real PDF bytes (`pdf-lib`). Checks inspect those
 * bytes — never the producer's self-report. C1's `layout_overflow` policy
 * writes real defects into the file (clipped text, unembedded fonts, two
 * runs outside the page box).
 */
import { newId } from "@/lib/ids";
import type { ExecutionPolicy } from "./types";
import { renderHtmlToPdf } from "./pdf/render";

export type SourceDocument = {
  html: string;
  text: string;
  links: string[];
  /** ~3,000 characters per A4 page at body size with 2cm margins. */
  expected_pages: number;
  page_size: "A4";
  margins_cm: number;
};

export type PdfArtifact = {
  artifact_ref: string;
  kind: "pdf";
  producer_agent_id: string;
  /** Real PDF, base64 — facts are read from these bytes. */
  pdf_base64: string;
  /** The producer's own claim — displayed as suspect, never trusted (D-005). */
  self_report: number;
  observed_latency_ms: number;
  declared_latency_ms: number;
};

const CHARS_PER_PAGE = 3000;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLinks(html: string): string[] {
  const links: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return links;
}

export function parseSource(html: string, requirement: string): SourceDocument {
  const text = stripHtml(html);
  const margins = /(\d+(?:\.\d+)?)\s*cm\s*margins?/i.exec(requirement);
  return {
    html,
    text,
    links: extractLinks(html),
    expected_pages: Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)),
    page_size: "A4",
    margins_cm: margins ? Number(margins[1]) : 2,
  };
}

export async function renderDeliverable(
  source: SourceDocument,
  producerAgentId: string,
  policy: ExecutionPolicy,
): Promise<PdfArtifact> {
  const started = performance.now();
  const { bytes } = await renderHtmlToPdf(source, policy);
  return {
    artifact_ref: newId("art"),
    kind: "pdf",
    producer_agent_id: producerAgentId,
    pdf_base64: Buffer.from(bytes).toString("base64"),
    self_report: policy.self_report,
    observed_latency_ms: Math.round(performance.now() - started),
    declared_latency_ms: Math.round(policy.latency_s * 1000),
  };
}

export const DEMO_INPUT_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Underwrite — Confidence SLA Term Sheet</title></head>
<body>
<h1>Confidence SLA Term Sheet</h1>
<p>This document describes the terms under which a buyer agent purchases a confidence-backed deliverable from a seller agent on the Underwrite marketplace. The buyer declares four things: the task requirement, the maximum price, the maximum latency and the minimum confidence. Everything after that happens between agents.</p>
<h2>1. Parties</h2>
<p>The buyer is any agent that can call the request endpoint. The seller is the agent whose plan is selected by the marketplace policy. Subcontractors are agents declared in the seller's chain before execution starts. See <a href="https://example.com/underwrite/registry">the registry</a> for capability manifests.</p>
<h2>2. The plan is the contract</h2>
<p>Before executing, every agent publishes a plan with five declarations: the deliverable, the promised confidence, the maximum cost, the deadline and the declared chain. The plan is validated automatically against the buyer's constraints. A plan that declares more cost, more latency or less confidence than the request allows is rejected with the exact reason, and the agent reformulates within budget. No human approves a plan; approval is validation.</p>
<h2>3. Escrow and settlement</h2>
<p>Each hop of the chain is an independent contract with its own escrow and its own confidence floor. The producer is paid only when the verdict is pass and the delivered confidence meets the floor. There is no partial payment for effort. A hop that blows its own promised confidence forfeits its stake to the marketplace, which funds verification and the commission on settled transactions.</p>
<h2>4. Verification</h2>
<p>Confidence is never self-declared. Deterministic checks provide ground truth where it exists: a valid PDF, the expected page count, extracted text matching the source, no layout overflow, embedded fonts and preserved links. Independent judges from a different model family than the producer see only the artifact and the rubric. Disagreement between judges is a signal and counts against the SLA.</p>
<h2>5. Attribution</h2>
<p>When a delivery fails, the audit log is walked back to the decision that caused the failure. An executor that delivered badly loses execution score. A hirer that ignored history loses selection score. An underwriter that promised a confidence its chain could not sustain loses underwriting score. An ambiguous specification penalizes nobody and is returned for clarification, so that no agent learns to sandbag. Details at <a href="https://example.com/underwrite/attribution">attribution</a>.</p>
<h2>6. Guardrails</h2>
<p>Maximum delegation depth is two. Each delegation creates at most four subtasks. The sum of child budgets never exceeds the parent budget minus overhead. Child deadlines never exceed parent deadlines. No agent hires an agent already above it in the chain.</p>
<h2>7. Honest failure</h2>
<p>If no candidate meets the required confidence within budget, the marketplace says so. It does not round confidence up and it does not deliver an artifact flagged as acceptable. The failure policy declared with the request decides between a full refund, a discounted flagged delivery, or acceptance below the SLA.</p>
<p>Signed by no human. Executed by agents. Counter on screen: human_interventions: 0.</p>
</body>
</html>`;
