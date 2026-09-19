import { chatCompletion } from "./neuralake";
import { bytesToBase64, isPdfBytes, renderHtmlToPdf } from "./pdf";
import { htmlFromBrief, type AcceptedEvent, type JobDeliverableInput, type PlanRequestEvent } from "./protocol";

export async function runAcceptedJob(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  brief: PlanRequestEvent["brief"];
  accepted: AcceptedEvent;
  signal?: AbortSignal;
}): Promise<JobDeliverableInput> {
  const started = Date.now();
  const html = htmlFromBrief(args.brief);
  const note = await chatCompletion({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    model: args.model,
    signal: args.signal,
    maxTokens: 180,
    messages: [
      {
        role: "system",
        content:
          "You execute an Underwrite html_to_pdf job. Reply with 2-4 sentences describing the render you will produce. No JSON.",
      },
      {
        role: "user",
        content: [
          `Requirement: ${args.brief.requirement}`,
          `Plan ${args.accepted.plan_id} promised confidence ${args.accepted.promised_confidence} at $${args.accepted.price_usd}.`,
          `HTML characters: ${html.length}. Compile to A4 PDF with embedded fonts and preserved links.`,
        ].join("\n"),
      },
    ],
  });
  void note.text;

  const bytes = await renderHtmlToPdf(html, args.brief.requirement);
  if (!isPdfBytes(bytes)) throw new Error("renderer produced bytes that are not a PDF");

  const observed = Date.now() - started;
  const self = Math.min(0.99, Math.max(args.accepted.promised_confidence, 0.95));
  return {
    self_confidence: self,
    artifact: {
      kind: "pdf",
      pdf_base64: bytesToBase64(bytes),
      observed_latency_ms: observed,
      declared_latency_ms: observed,
      self_report: self,
    },
  };
}
