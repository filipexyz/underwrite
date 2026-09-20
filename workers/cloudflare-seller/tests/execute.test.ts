import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatCompletion } = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
}));

const { renderHtmlToPdf } = vi.hoisted(() => ({
  renderHtmlToPdf: vi.fn(async () => new TextEncoder().encode("%PDF-1.4 mock")),
}));

vi.mock("../src/neuralake", async () => {
  const actual = await vi.importActual<typeof import("../src/neuralake")>("../src/neuralake");
  return { ...actual, chatCompletion };
});

vi.mock("../src/pdf", async () => {
  const actual = await vi.importActual<typeof import("../src/pdf")>("../src/pdf");
  return { ...actual, renderHtmlToPdf };
});

import { extractFileBundle, extractHtmlDocument } from "../src/neuralake";
import {
  estimateSelfReport,
  isExecutableJobHtml,
  isPdfDeliverableCategory,
  resolveJobCategory,
  runAcceptedJob,
  shouldCompileProvidedHtml,
  wantsZipBundle,
} from "../src/execute";
import { isZipBytes } from "../src/zip";
import type { AcceptedEvent, PlanRequestEvent } from "../src/protocol";

const MODEL_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Investment briefing</title></head>
<body>
  <h1>Investment briefing</h1>
  <h2>Findings</h2>
  <p>Yields on the reference names remain above the cost of capital after FX hedging.</p>
  <h2>Risks</h2>
  <p>Duration and political risk still dominate the left tail.</p>
  <h2>Recommendation</h2>
  <p>Hold the core book and hedge residual BRL exposure.</p>
</body>
</html>`;

function accepted(overrides: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    type: "accepted",
    job_id: "req_specialty",
    request_id: "req_specialty",
    plan_id: "plan_specialty",
    execute: true,
    price_usd: 0.04,
    promised_confidence: 0.96,
    constraints: {
      max_cost_usd: 0.05,
      max_latency_s: 30,
      min_confidence: 0.95,
      category: "analista de investimentos",
    },
    ...overrides,
  };
}

function completion(text: string) {
  return { text, model: "auto", tokens_in: 20, tokens_out: 400 };
}

describe("execute path selection", () => {
  it("compiles html_to_pdf only when the brief already has a source HTML file", () => {
    const withFile: PlanRequestEvent["brief"] = {
      requirement: "Compile input.html to a PDF.",
      files: [{ name: "input.html", media_type: "text/html", content: "<h1>Hello</h1>" }],
    };
    const noFile: PlanRequestEvent["brief"] = {
      requirement: "Act as an executor specializing in analista de investimentos.",
      files: [],
    };
    expect(shouldCompileProvidedHtml("html_to_pdf", withFile)).toBe(true);
    expect(shouldCompileProvidedHtml("html_to_pdf", noFile)).toBe(false);
    expect(shouldCompileProvidedHtml("analista de investimentos", withFile)).toBe(false);
    expect(shouldCompileProvidedHtml("research_report", withFile)).toBe(false);
    expect(isPdfDeliverableCategory("html_to_pdf")).toBe(true);
    expect(isPdfDeliverableCategory("analista de investimentos")).toBe(false);
    expect(isPdfDeliverableCategory("landing_page")).toBe(false);
    expect(resolveJobCategory(undefined)).toBe("html_to_pdf");
    expect(wantsZipBundle("analista de investimentos", "Deliver an HTML briefing with findings.")).toBe(false);
    expect(wantsZipBundle("research_report", "Ship report.md and data.json as a zip.")).toBe(true);
    expect(wantsZipBundle("dashboard", "Build a dashboard with a json dataset.")).toBe(true);
    expect(wantsZipBundle("landing_page", "Ship a landing page.")).toBe(false);
  });

  it("rejects the tiny Underwrite-job wrapper as executable HTML", () => {
    expect(isExecutableJobHtml("<!doctype html><html><body><h1>Underwrite job</h1><p>Act as an analyst.</p></body></html>")).toBe(
      false,
    );
    expect(isExecutableJobHtml(MODEL_HTML)).toBe(true);
  });

  it("estimates self-report from structure and never reaches 0.95+", () => {
    const score = estimateSelfReport(MODEL_HTML);
    expect(score).toBeLessThanOrEqual(0.9);
    expect(score).toBeGreaterThan(0.5);
    expect(score).not.toBe(0.96);
    expect(score).not.toBe(0.95);
  });
});

describe("extractHtmlDocument", () => {
  it("strips markdown fences and keeps the document", () => {
    expect(extractHtmlDocument("```html\n" + MODEL_HTML + "\n```")).toContain("<h1>Investment briefing</h1>");
    expect(extractHtmlDocument("```html\n\n```")).toBeNull();
    expect(extractHtmlDocument("just a note about the PDF")).toBeNull();
  });
});

describe("extractFileBundle", () => {
  it("reads a files array from raw or fenced JSON", () => {
    const bundle = { files: [{ name: "report.md", content: "# Hold" }, { name: "data.json", content: "{}" }] };
    expect(extractFileBundle(JSON.stringify(bundle))?.map((f) => f.name)).toEqual(["report.md", "data.json"]);
    expect(extractFileBundle("```json\n" + JSON.stringify(bundle) + "\n```")?.length).toBe(2);
    expect(extractFileBundle("no files here")).toBeNull();
  });
});

describe("runAcceptedJob", () => {
  beforeEach(() => {
    chatCompletion.mockReset();
    renderHtmlToPdf.mockClear();
    renderHtmlToPdf.mockImplementation(async () => new TextEncoder().encode("%PDF-1.4 mock"));
  });

  it("delivers NeuraLake HTML for a specialty job with no source file — not a PDF and not htmlFromBrief", async () => {
    chatCompletion.mockResolvedValue(completion(MODEL_HTML));

    const result = await runAcceptedJob({
      baseUrl: "https://api.neuralake.cloud/v1",
      apiKey: "nl_test",
      model: "auto",
      brief: {
        requirement: "Act as an executor specializing in analista de investimentos. Deliver findings, risks, and a recommendation.",
        files: [],
      },
      accepted: accepted(),
    });

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const call = chatCompletion.mock.calls[0][0] as { maxTokens: number; messages: Array<{ content: string }> };
    expect(call.maxTokens).toBeGreaterThanOrEqual(2000);
    expect(call.messages[0].content).toMatch(/HTML only/i);
    expect(call.messages[1].content).toMatch(/analista de investimentos/);

    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(result.artifact.kind).toBe("html");
    expect(result.artifact.html).toContain("Investment briefing");
    expect(result.artifact.html).toContain("Recommendation");
    expect(result.artifact.html).not.toContain("<h1>Underwrite job</h1>");
    expect(result.artifact.pdf_base64).toBeUndefined();

    expect(result.self_confidence).toBeLessThanOrEqual(0.9);
    expect(result.self_confidence).not.toBe(0.96);
    expect(result.artifact.self_report).toBe(result.self_confidence);
  });

  it("still delivers HTML when a specialty fixture attached brief.html", async () => {
    chatCompletion.mockResolvedValue(completion(MODEL_HTML));
    const briefHtml = `<!doctype html><html><body><h1>Agent · analista de investimentos</h1><p>Produce a structured HTML briefing.</p></body></html>`;

    const result = await runAcceptedJob({
      baseUrl: "https://api.neuralake.cloud/v1",
      apiKey: "nl_test",
      model: "auto",
      brief: {
        requirement: "Act as an executor specializing in analista de investimentos.",
        files: [{ name: "brief.html", media_type: "text/html", content: briefHtml }],
      },
      accepted: accepted(),
      category: "analista de investimentos",
    });

    expect(chatCompletion).toHaveBeenCalled();
    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(result.artifact.kind).toBe("html");
    expect(result.artifact.html).toContain("Investment briefing");
    expect(result.artifact.html).not.toBe(briefHtml);
    expect(result.artifact.pdf_base64).toBeUndefined();
  });

  it("compiles the provided HTML to PDF for html_to_pdf and does not call the model", async () => {
    const source = `<!doctype html><html><body><h1>Hello</h1><p>See <a href="https://example.com/underwrite">docs</a>.</p></body></html>`;

    const result = await runAcceptedJob({
      baseUrl: "https://api.neuralake.cloud/v1",
      apiKey: "nl_test",
      model: "auto",
      brief: {
        requirement: "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
        files: [{ name: "input.html", media_type: "text/html", content: source }],
      },
      accepted: accepted({
        job_id: "req_html",
        request_id: "req_html",
        constraints: { max_cost_usd: 0.05, max_latency_s: 30, min_confidence: 0.95, category: "html_to_pdf" },
      }),
      category: "html_to_pdf",
    });

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(renderHtmlToPdf).toHaveBeenCalledWith(source, expect.any(String));
    expect(result.artifact.kind).toBe("pdf");
    expect(result.artifact.pdf_base64).toBeTruthy();
    expect(result.artifact.html).toBeUndefined();
    expect(result.self_confidence).toBeLessThanOrEqual(0.9);
    expect(result.self_confidence).not.toBe(0.96);
  });

  it("strips fences, retries once on empty HTML, then throws instead of using a stub PDF", async () => {
    chatCompletion.mockResolvedValueOnce(completion("```html\n\n```")).mockResolvedValueOnce(completion("not a document"));

    await expect(
      runAcceptedJob({
        baseUrl: "https://api.neuralake.cloud/v1",
        apiKey: "nl_test",
        model: "auto",
        brief: { requirement: "Write an investment briefing.", files: [] },
        accepted: accepted(),
      }),
    ).rejects.toThrow(/did not return executable HTML/i);

    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(renderHtmlToPdf).not.toHaveBeenCalled();
  });

  it("retries once and accepts the second HTML document as kind html", async () => {
    chatCompletion.mockResolvedValueOnce(completion("just a note")).mockResolvedValueOnce(completion("```html\n" + MODEL_HTML + "\n```"));

    const result = await runAcceptedJob({
      baseUrl: "https://api.neuralake.cloud/v1",
      apiKey: "nl_test",
      model: "auto",
      brief: { requirement: "Write an investment briefing.", files: [] },
      accepted: accepted(),
    });

    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(result.artifact.kind).toBe("html");
    expect(result.artifact.html).toContain("<h1>Investment briefing</h1>");
    expect(result.artifact.html).not.toContain("```");
  });

  it("delivers a ZIP when the specialty brief asks for multiple named files", async () => {
    const bundle = {
      files: [
        {
          name: "report.md",
          content: "# Findings\n\nYields remain above the cost of capital.\n\n## Risks\n\nFX.\n\n## Recommendation\n\nHold.\n",
        },
        { name: "data.json", content: '{"hold":true,"names":["PETR4"]}' },
      ],
    };
    chatCompletion.mockResolvedValue(completion(JSON.stringify(bundle)));

    const result = await runAcceptedJob({
      baseUrl: "https://api.neuralake.cloud/v1",
      apiKey: "nl_test",
      model: "auto",
      brief: {
        requirement: "Produce report.md and data.json for this analista de investimentos assignment.",
        files: [],
      },
      accepted: accepted(),
    });

    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(result.artifact.kind).toBe("zip");
    expect(result.artifact.zip_base64).toBeTruthy();
    expect(result.artifact.pdf_base64).toBeUndefined();
    const bytes = Uint8Array.from(Buffer.from(result.artifact.zip_base64 ?? "", "base64"));
    expect(isZipBytes(bytes)).toBe(true);
    expect(result.self_confidence).toBeLessThanOrEqual(0.9);
  });

  it("delivers a single markdown file when the zip-shaped brief only yields one artifact", async () => {
    chatCompletion.mockResolvedValue(
      completion(JSON.stringify({ files: [{ name: "report.md", content: "# Findings\n\nHold the book.\n\n## Risks\n\nFX.\n" }] })),
    );

    const result = await runAcceptedJob({
      baseUrl: "https://api.neuralake.cloud/v1",
      apiKey: "nl_test",
      model: "auto",
      brief: {
        requirement: "Produce report.md and data.json for this assignment.",
        files: [],
      },
      accepted: accepted(),
    });

    expect(renderHtmlToPdf).not.toHaveBeenCalled();
    expect(result.artifact.kind).toBe("md");
    expect(result.artifact.markdown).toContain("# Findings");
    expect(result.artifact.zip_base64).toBeUndefined();
    expect(result.artifact.pdf_base64).toBeUndefined();
  });
});
