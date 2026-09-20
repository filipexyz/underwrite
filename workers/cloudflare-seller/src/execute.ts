import { stripHtml } from "./html";
import { chatCompletion, extractFileBundle, extractHtmlDocument, type BundleFile } from "./neuralake";
import { bytesToBase64, isPdfBytes, renderHtmlToPdf } from "./pdf";
import {
  briefHasHtmlFile,
  sourceHtmlFromBrief,
  type AcceptedEvent,
  type JobDeliverableInput,
  type PlanRequestEvent,
} from "./protocol";
import { buildZip } from "./zip";

export const HTML_TO_PDF_CATEGORY = "html_to_pdf";
const SPECIALTY_MAX_TOKENS = 3500;
const MIN_EXECUTABLE_TEXT = 80;
const SELF_REPORT_CAP = 0.9;

export function resolveJobCategory(category: string | undefined | null): string {
  const trimmed = category?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : HTML_TO_PDF_CATEGORY;
}

/** PDF is only the deliverable for html_to_pdf — never for other specialties. */
export function isPdfDeliverableCategory(category: string | undefined | null): boolean {
  return resolveJobCategory(category) === HTML_TO_PDF_CATEGORY;
}

/** Compile the buyer’s HTML only for html_to_pdf jobs that shipped a source file. */
export function shouldCompileProvidedHtml(
  category: string | undefined | null,
  brief: PlanRequestEvent["brief"],
): boolean {
  return isPdfDeliverableCategory(category) && briefHasHtmlFile(brief);
}

/** Multi-file jobs (named files, zip, dashboard data) prefer a ZIP over a single HTML page. */
export function wantsZipBundle(category: string, requirement: string): boolean {
  const text = requirement.toLowerCase();
  if (/\bzip\b|\.zip\b/.test(text)) return true;
  const named = requirement.match(/\b[\w.-]+\.(md|html?|json|csv|txt|png|svg)\b/gi) ?? [];
  if (named.length >= 2) return true;
  if (category === "dashboard" && /\b(json|data|csv|screenshot)/i.test(text)) return true;
  return false;
}

export function isExecutableJobHtml(html: string): boolean {
  const text = stripHtml(html);
  if (text.length < MIN_EXECUTABLE_TEXT) return false;
  if (!/<(?:h[1-3]|p|section|article|ul|ol|table)\b/i.test(html)) return false;
  if (/<h1>\s*Underwrite job\s*<\/h1>/i.test(html)) return false;
  return true;
}

export function isExecutableBundle(files: BundleFile[]): boolean {
  if (files.length === 0) return false;
  return files.some((f) => f.content.trim().length >= MIN_EXECUTABLE_TEXT || isExecutableJobHtml(f.content));
}

/** Conservative self-score from the document itself — never copied from promised_confidence. */
export function estimateSelfReport(html: string): number {
  const text = stripHtml(html);
  const headingCount = (html.match(/<h[1-3]\b|#\s+\S/gi) ?? []).length;
  const paraCount = (html.match(/<p\b|\n\n/gi) ?? []).length;
  let score = 0.55;
  if (text.length >= 400) score += 0.1;
  if (text.length >= 1200) score += 0.08;
  if (headingCount >= 3) score += 0.1;
  if (paraCount >= 3) score += 0.07;
  return Math.min(SELF_REPORT_CAP, Math.round(score * 1000) / 1000);
}

function reportShapeHint(category: string): string {
  const c = category.toLowerCase();
  if (c === HTML_TO_PDF_CATEGORY) {
    return "There is no source HTML to compile. Write a complete HTML document that fulfills the requirement.";
  }
  if (c === "landing_page") {
    return "Write a complete landing page: document title, primary heading, primary CTA, viewport meta, and the sections named in the brief.";
  }
  if (c === "dashboard") {
    return "Write a complete dashboard: a primary view plus a data file (data.json) when the brief asks for metrics or a dataset.";
  }
  if (/invest|analista|analyst|research/.test(c)) {
    return "Write an investment/research briefing: executive summary, structured findings, material risks, and a clear recommendation.";
  }
  return "Write a complete specialty report with clear headings, findings, risks or caveats, and a recommendation or next step.";
}

function briefFileContext(brief: PlanRequestEvent["brief"]): string {
  if (brief.files.length === 0) return "Files: (none)";
  return brief.files
    .map((file) => {
      const body = file.content.trim();
      const clipped = body.length > 8000 ? `${body.slice(0, 8000)}\n…[truncated]` : body;
      return `File ${file.name} (${file.media_type}):\n${clipped || "(empty)"}`;
    })
    .join("\n\n");
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function scoredArtifact(
  artifact: JobDeliverableInput["artifact"],
  htmlForScore: string,
): JobDeliverableInput {
  const self = estimateSelfReport(htmlForScore);
  return {
    self_confidence: self,
    artifact: { ...artifact, self_report: self },
  };
}

function singleFileDeliverable(file: BundleFile, observed: number): JobDeliverableInput {
  const name = file.name.toLowerCase();
  if (/\.md$/.test(name) || name.endsWith(".markdown")) {
    return scoredArtifact(
      { kind: "md", markdown: file.content, observed_latency_ms: observed, declared_latency_ms: observed },
      file.content,
    );
  }
  return scoredArtifact(
    { kind: "html", html: file.content, observed_latency_ms: observed, declared_latency_ms: observed },
    file.content,
  );
}

function zipDeliverable(files: BundleFile[], observed: number): JobDeliverableInput {
  const bytes = buildZip(files);
  const scoreText = files.map((f) => f.content).join("\n");
  return scoredArtifact(
    {
      kind: "zip",
      zip_base64: bytesToBase64(bytes),
      observed_latency_ms: observed,
      declared_latency_ms: observed,
    },
    scoreText,
  );
}

async function complete(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}) {
  return chatCompletion({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    signal: args.signal,
    maxTokens: SPECIALTY_MAX_TOKENS,
    messages: args.messages,
  });
}

async function generateSpecialtyHtml(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  category: string;
  brief: PlanRequestEvent["brief"];
  accepted: AcceptedEvent;
  signal?: AbortSignal;
}): Promise<string> {
  const user = [
    `Category: ${args.category}`,
    `Requirement: ${args.brief.requirement}`,
    briefFileContext(args.brief),
    `Plan ${args.accepted.plan_id} was accepted at $${args.accepted.price_usd}.`,
    reportShapeHint(args.category),
    "This deliverable is HTML, not a PDF. Do not mention compiling to A4 or wrapping the brief in a stub page.",
    "Cover the assignment’s topics so the buyer can verify the report.",
    "Reply with a complete HTML document only.",
  ].join("\n\n");

  const messages = [
    {
      role: "system" as const,
      content: [
        `You execute an Underwrite ${args.category} job as a hireable specialist.`,
        "Reply with a complete HTML document that fulfills the buyer’s requirement.",
        "HTML only — no markdown fences, no commentary, no cover-page stub, no PDF.",
        "Use <!doctype html>, <html>, <head> with <title>, <body>, h1–h3 headings, and paragraphs.",
        "Do not wrap the requirement in a single <h1>Underwrite job</h1> page.",
      ].join(" "),
    },
    { role: "user" as const, content: user },
  ];

  const first = await complete({ ...args, messages });
  const firstHtml = extractHtmlDocument(first.text);
  if (firstHtml && isExecutableJobHtml(firstHtml)) return firstHtml;

  const retry = await complete({
    ...args,
    messages: [
      ...messages,
      { role: "assistant", content: first.text },
      {
        role: "user",
        content:
          "Your previous reply was empty, fenced, or not a usable HTML report. Reply again with a complete HTML document only — no markdown fences, no PDF.",
      },
    ],
  });
  const retryHtml = extractHtmlDocument(retry.text);
  if (retryHtml && isExecutableJobHtml(retryHtml)) return retryHtml;

  throw new Error(
    `NeuraLake did not return executable HTML for ${args.category} job ${args.accepted.job_id} after retry (got ${preview(retry.text || first.text) || "empty"})`,
  );
}

async function generateSpecialtyFiles(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  category: string;
  brief: PlanRequestEvent["brief"];
  accepted: AcceptedEvent;
  signal?: AbortSignal;
}): Promise<BundleFile[] | null> {
  const user = [
    `Category: ${args.category}`,
    `Requirement: ${args.brief.requirement}`,
    briefFileContext(args.brief),
    `Plan ${args.accepted.plan_id} was accepted at $${args.accepted.price_usd}.`,
    reportShapeHint(args.category),
    "Produce multiple files the buyer can unzip: typically a prose report (report.md or index.html) plus structured data (data.json) or other named files from the brief.",
    'Reply with a single JSON object only: {"files":[{"name":"report.md","content":"..."},{"name":"data.json","content":"..."}]}',
    "No markdown fences, no PDF, no stub page.",
  ].join("\n\n");

  const messages = [
    {
      role: "system" as const,
      content: [
        `You execute an Underwrite ${args.category} job as a hireable specialist.`,
        "Reply with JSON only — an object with a files array of {name, content}.",
        "Each content value is the full file. Produce at least two real files that fulfill the requirement.",
      ].join(" "),
    },
    { role: "user" as const, content: user },
  ];

  const first = await complete({ ...args, messages });
  const firstFiles = extractFileBundle(first.text);
  if (firstFiles && isExecutableBundle(firstFiles)) return firstFiles;

  const retry = await complete({
    ...args,
    messages: [
      ...messages,
      { role: "assistant", content: first.text },
      {
        role: "user",
        content:
          'Your previous reply was not a usable file bundle. Reply again with JSON only: {"files":[{"name":"...","content":"..."},{"name":"...","content":"..."}]}',
      },
    ],
  });
  const retryFiles = extractFileBundle(retry.text);
  if (retryFiles && isExecutableBundle(retryFiles)) return retryFiles;
  return null;
}

export async function runAcceptedJob(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  brief: PlanRequestEvent["brief"];
  accepted: AcceptedEvent;
  /** Remembered from plan_request when the accepted webhook omits category. */
  category?: string;
  signal?: AbortSignal;
}): Promise<JobDeliverableInput> {
  const started = Date.now();
  const category = resolveJobCategory(args.category ?? args.accepted.constraints?.category);
  const pdfJob = isPdfDeliverableCategory(category);

  if (shouldCompileProvidedHtml(category, args.brief)) {
    const html = sourceHtmlFromBrief(args.brief) ?? "";
    if (!html.trim()) {
      throw new Error(`html_to_pdf job ${args.accepted.job_id} is missing source HTML`);
    }
    const bytes = await renderHtmlToPdf(html, args.brief.requirement);
    if (!isPdfBytes(bytes)) throw new Error("renderer produced bytes that are not a PDF");
    return scoredArtifact(
      {
        kind: "pdf",
        pdf_base64: bytesToBase64(bytes),
        observed_latency_ms: Date.now() - started,
        declared_latency_ms: Date.now() - started,
      },
      html,
    );
  }

  if (pdfJob) {
    const html = await generateSpecialtyHtml({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      model: args.model,
      category,
      brief: args.brief,
      accepted: args.accepted,
      signal: args.signal,
    });
    const bytes = await renderHtmlToPdf(html, args.brief.requirement);
    if (!isPdfBytes(bytes)) throw new Error("renderer produced bytes that are not a PDF");
    return scoredArtifact(
      {
        kind: "pdf",
        pdf_base64: bytesToBase64(bytes),
        observed_latency_ms: Date.now() - started,
        declared_latency_ms: Date.now() - started,
      },
      html,
    );
  }

  if (wantsZipBundle(category, args.brief.requirement)) {
    const files = await generateSpecialtyFiles({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      model: args.model,
      category,
      brief: args.brief,
      accepted: args.accepted,
      signal: args.signal,
    });
    const observed = Date.now() - started;
    if (files && files.length >= 2) return zipDeliverable(files, observed);
    if (files && files.length === 1) return singleFileDeliverable(files[0], observed);
  }

  const html = await generateSpecialtyHtml({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    category,
    brief: args.brief,
    accepted: args.accepted,
    signal: args.signal,
  });
  const observed = Date.now() - started;
  return scoredArtifact(
    {
      kind: "html",
      html,
      observed_latency_ms: observed,
      declared_latency_ms: observed,
    },
    html,
  );
}
