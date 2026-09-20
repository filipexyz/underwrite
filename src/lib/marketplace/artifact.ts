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

export type ArtifactKind = "pdf" | "html" | "md";

export type ArtifactScreenshot = {
  name?: string;
  viewport?: string;
  data_base64?: string;
};

export type SourceDocument = {
  html: string;
  text: string;
  links: string[];
  /** ~3,000 characters per A4 page at body size with 2cm margins. */
  expected_pages: number;
  /** True when `expected_pages` came from the brief rather than from source length. */
  pages_stated: boolean;
  page_size: "A4";
  margins_cm: number;
  requirement?: string;
  expected_sections?: string[];
  expected_topics?: string[];
  expected_metrics?: string[];
  min_word_count?: number;
};

export type DeliveryArtifact = {
  artifact_ref: string;
  kind: ArtifactKind;
  producer_agent_id: string;
  /** The producer's own claim — displayed as suspect, never trusted (D-005). */
  self_report: number;
  observed_latency_ms: number;
  declared_latency_ms: number;
  pdf_base64?: string;
  html?: string;
  markdown?: string;
  url?: string;
  screenshots?: ArtifactScreenshot[];
};

export type PdfArtifact = DeliveryArtifact & {
  kind: "pdf";
  /** Real PDF, base64 — facts are read from these bytes. */
  pdf_base64: string;
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

const SECTION_WORDS = ["hero", "features", "pricing", "about", "faq", "testimonials", "contact", "team", "product", "footer"];

function impliedSections(requirement: string): string[] {
  const lower = requirement.toLowerCase();
  return SECTION_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function impliedTopics(requirement: string): string[] {
  const quoted = [...requirement.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1].trim()).filter(Boolean);
  if (quoted.length > 0) return quoted;
  const about = /(?:cover(?:ing|s)?|topics?:)\s+(.+?)(?:\s+with\s+|\.|$)/i.exec(requirement);
  if (!about) return [];
  return about[1]
    .split(/,| and /i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function impliedMetrics(requirement: string): string[] {
  const named = [...requirement.matchAll(/\b(?:metric|kpi|stat)s?\s*[:=]\s*([^.;]+)/gi)].flatMap((m) =>
    m[1].split(/,| and /i).map((s) => s.trim()).filter(Boolean),
  );
  if (named.length > 0) return named;
  return [...requirement.matchAll(/\b([a-z][\w-]{1,24})\s+(?:metric|kpi|stat)s?\b/gi)].map((m) => m[1]);
}

function impliedMinWords(requirement: string): number | undefined {
  const m = /(?:at least|min(?:imum)?(?:\s+length)?|≥|>=)\s*(\d+)\s*words/i.exec(requirement);
  return m ? Number(m[1]) : undefined;
}


const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, "três": 3,
  quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

/**
 * A page count the buyer actually stated, e.g. "four-page PDF" or "4 páginas".
 *
 * This is the difference between a requirement and an estimate, and it is the whole point: `expected_pages`
 * below is a *heuristic* from the source length (chars / 3000), which is why the check compares it with a
 * +/-1 tolerance. When the brief states a number, that number is a requirement and the comparison is exact.
 *
 * A live run made this concrete: the brief asked for a four-page translation, the artifact was one page, and
 * the check passed because an estimate was being compared with a tolerance.
 */
export function impliedPageCount(requirement: string): number | undefined {
  const word = Object.keys(NUMBER_WORDS).join("|");
  const m = new RegExp(`\\b(\\d{1,3}|${word})\\s*[- ]?p(?:ages?|áginas?|aginas?)\\b`, "i").exec(requirement);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return n && n > 0 ? n : undefined;
}

export function parseSource(html: string, requirement: string): SourceDocument {
  const text = stripHtml(html);
  const margins = /(\d+(?:\.\d+)?)\s*cm\s*margins?/i.exec(requirement);
  return {
    html,
    text,
    links: extractLinks(html),
    // Stated in the brief -> a requirement. Absent -> an estimate from the source length, which is why the
    // check tolerates +/-1 only in that case.
    expected_pages: impliedPageCount(requirement) ?? Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)),
    pages_stated: impliedPageCount(requirement) !== undefined,
    page_size: "A4",
    margins_cm: margins ? Number(margins[1]) : 2,
    requirement,
    expected_sections: impliedSections(requirement),
    expected_topics: impliedTopics(requirement),
    expected_metrics: impliedMetrics(requirement),
    min_word_count: impliedMinWords(requirement),
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
