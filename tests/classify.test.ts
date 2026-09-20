/**
 * Task classification — keyword heuristic when JEV is unavailable, and the
 * weak-JEV override that kept landing briefs out of html_to_pdf.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyRequirementHeuristic,
  classifyTask,
} from "@/lib/typesafe/classify";
import { DEFAULT_VOICE_CATEGORY } from "@/lib/voice/types";
import { voiceBriefToRequestInput } from "@/lib/voice/handoff";

/** Live failure (req_4dab127f574b42b69370): single-page landing, literally nothing + do-nothing button. */
const LITERALLY_NOTHING_LANDING =
  "A single-page landing page with literally nothing on it and a big do-nothing button.";

const PDF_COMPILE = "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.";

const savedKey = process.env.TYPESAFE_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = savedKey;
});

describe("classifyRequirementHeuristic", () => {
  it("classifies the literally-nothing landing brief as landing_page", () => {
    expect(classifyRequirementHeuristic(LITERALLY_NOTHING_LANDING)).toBe("landing_page");
  });

  it("classifies a PDF compile brief as html_to_pdf", () => {
    expect(classifyRequirementHeuristic(PDF_COMPILE)).toBe("html_to_pdf");
    expect(classifyRequirementHeuristic("Convert this document into a PDF, reproducing its content faithfully.")).toBe(
      "html_to_pdf",
    );
  });

  it("does not let a website-to-PDF compile fall into landing_page", () => {
    expect(classifyRequirementHeuristic("Compile this website into a PDF")).toBe("html_to_pdf");
  });

  it("follows dashboard / research keywords", () => {
    expect(classifyRequirementHeuristic("Build a dashboard of revenue metrics with filters")).toBe("dashboard");
    expect(classifyRequirementHeuristic("Research the market and write a report with citations and findings")).toBe(
      "research_report",
    );
  });

  it("last-resort: no PDF language → landing_page or research_report, never html_to_pdf", () => {
    expect(classifyRequirementHeuristic("")).toBe("landing_page");
    expect(classifyRequirementHeuristic("make a hero layout with viewport meta")).toBe("landing_page");
    expect(classifyRequirementHeuristic("Write an analysis explaining the trade-offs")).toBe("research_report");
    expect(classifyRequirementHeuristic("something vague")).toBe("landing_page");
  });
});

describe("DEFAULT_VOICE_CATEGORY", () => {
  it("aligns with the empty-brief heuristic instead of forcing PDF", () => {
    expect(DEFAULT_VOICE_CATEGORY).toBe("landing_page");
    expect(DEFAULT_VOICE_CATEGORY).toBe(classifyRequirementHeuristic(""));
    expect(DEFAULT_VOICE_CATEGORY).not.toBe("html_to_pdf");
  });
});

describe("classifyTask without TYPESAFE_API_KEY", () => {
  it("classifies the literally-nothing landing brief as landing_page via the heuristic", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const result = await classifyTask(LITERALLY_NOTHING_LANDING);
    expect(result.category).toBe("landing_page");
    expect(result.source).toBe("heuristic");
  });

  it("still classifies PDF compile briefs as html_to_pdf", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const result = await classifyTask(PDF_COMPILE);
    expect(result.category).toBe("html_to_pdf");
    expect(result.source).toBe("heuristic");
  });
});

describe("classifyTask when JEV is configured", () => {
  function mockJev(body: {
    choice?: string;
    probabilities?: Record<string, number>;
    confidence?: number;
    noul?: number;
    status?: number;
    fail?: boolean;
  }) {
    process.env.TYPESAFE_API_KEY = "test-jev-key";
    vi.stubGlobal("fetch", async () => {
      if (body.fail) throw new Error("timeout");
      if (body.status && body.status >= 400) return { ok: false, status: body.status };
      return {
        ok: true,
        json: async () => ({
          questions: {
            category: {
              choice: body.choice,
              probabilities: body.probabilities ?? {},
              confidence: body.confidence ?? 0,
            },
            spec_ambiguous: { noul: body.noul ?? 0 },
          },
          usage: { input_tokens: 200 },
        }),
      };
    });
  }

  it("keeps a decisive JEV category", async () => {
    mockJev({
      choice: "landing_page",
      probabilities: { landing_page: 0.86, html_to_pdf: 0.08, dashboard: 0.04, research_report: 0.02 },
      confidence: 0.86,
    });
    const result = await classifyTask(LITERALLY_NOTHING_LANDING);
    expect(result.category).toBe("landing_page");
    expect(result.source).toBe("jev");
  });

  it("prefers the heuristic over a weak JEV html_to_pdf guess on a clear landing brief", async () => {
    mockJev({
      choice: "html_to_pdf",
      probabilities: { html_to_pdf: 0.48, landing_page: 0.42, dashboard: 0.05, research_report: 0.05 },
      confidence: 0.48,
    });
    const result = await classifyTask(LITERALLY_NOTHING_LANDING);
    expect(result.category).toBe("landing_page");
    expect(result.source).toBe("heuristic");
    expect(result.ambiguous).toBe(true);
  });

  it("uses the heuristic on HTTP error, timeout, or unrecognized choice", async () => {
    mockJev({ status: 503 });
    expect((await classifyTask(LITERALLY_NOTHING_LANDING)).category).toBe("landing_page");

    mockJev({ fail: true });
    expect((await classifyTask(LITERALLY_NOTHING_LANDING)).category).toBe("landing_page");

    mockJev({ choice: "blog_post", probabilities: { blog_post: 1 }, confidence: 1 });
    const unrecognized = await classifyTask(LITERALLY_NOTHING_LANDING);
    expect(unrecognized.category).toBe("landing_page");
    expect(unrecognized.source).toBe("heuristic");
  });

  it("keeps a decisive JEV html_to_pdf on a compile brief", async () => {
    mockJev({
      choice: "html_to_pdf",
      probabilities: { html_to_pdf: 0.91, landing_page: 0.03, dashboard: 0.03, research_report: 0.03 },
      confidence: 0.91,
    });
    const result = await classifyTask(PDF_COMPILE);
    expect(result.category).toBe("html_to_pdf");
    expect(result.source).toBe("jev");
  });
});

describe("voiceBriefToRequestInput uses the heuristic when category is omitted", () => {
  it("does not stamp html_to_pdf onto the literally-nothing landing brief", () => {
    const input = voiceBriefToRequestInput({
      requirement: LITERALLY_NOTHING_LANDING,
      max_cost_usd: 0.2,
      max_latency_s: 60,
      min_confidence: 0.9,
      failure_policy: "refund",
    });
    expect(input.category).toBe("landing_page");
  });
});
