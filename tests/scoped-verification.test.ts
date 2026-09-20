import { describe, expect, it, beforeAll } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { EscrowRow } from "@/lib/db/schema";
import { getDb, type Db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { TASK_CATEGORY } from "@/lib/db/seed";
import { parseSource, type DeliveryArtifact, type SourceDocument } from "@/lib/marketplace/artifact";
import { buildContext } from "@/lib/marketplace/context";
import { slaMet } from "@/lib/marketplace/escrow";
import { createRequest } from "@/lib/marketplace/requests";
import { getAgent, judgesFor, loadRegistry } from "@/lib/marketplace/registry";
import { runChecks } from "@/lib/verification/checks";
import { inspectArtifact } from "@/lib/verification/inspect";
import { judgeFacts, runJudges } from "@/lib/verification/judges";
import {
  HTML_TO_PDF_RUBRIC,
  LANDING_PAGE_RUBRIC,
  RESEARCH_REPORT_RUBRIC,
  SPECIALTY_REPORT_RUBRIC,
  defaultRubricFor,
  scopeChecks,
} from "@/lib/verification/rubric";
import { verifyArtifact } from "@/lib/verification/verify";
import type { RegistryAgent } from "@/lib/marketplace/registry";
import type { ArtifactFacts } from "@/lib/verification/inspect";

const LANDING_TASK =
  "Build a landing page for Nexus with a title, primary CTA button, responsive viewport, and a hero section.";

const RESEARCH_TASK =
  "Write a research report covering climate policy and energy markets with citations and a sources section. At least 80 words.";

const NEXUS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nexus</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>
    <h1>Nexus</h1>
    <a class="cta" href="/signup">Get started</a>
  </header>
  <section id="hero">
    <h2>Hero</h2>
    <p>A clean landing page for the Nexus product with a clear offer.</p>
  </section>
  <img src="/logo.png" alt="Nexus">
</body>
</html>`;

const RESEARCH_MD = `# Climate policy briefing

## Findings
Climate policy and energy markets interact through carbon prices, grid investment, and demand response. Buyers need a concise map of those forces before they underwrite a recommendation.

## Risks
Policy reversal and commodity spikes can move the same portfolio in opposite directions. The brief should name both.

## Recommendation
Hold a balanced view of climate policy and energy markets, and revisit the thesis when the carbon price jumps.

## Sources
- https://example.com/climate
- https://example.com/energy
`;

function checkIds(spec: { checks: Array<{ check_id: string }> }): string[] {
  return spec.checks.map((c) => c.check_id);
}

function landingArtifact(): DeliveryArtifact {
  return {
    artifact_ref: "art_nexus",
    kind: "html",
    producer_agent_id: "c2-honest",
    html: NEXUS_HTML,
    self_report: 0.96,
    observed_latency_ms: 10,
    declared_latency_ms: 10,
  };
}

function researchArtifact(): DeliveryArtifact {
  return {
    artifact_ref: "art_report",
    kind: "md",
    producer_agent_id: "c2-honest",
    markdown: RESEARCH_MD,
    self_report: 0.9,
    observed_latency_ms: 10,
    declared_latency_ms: 10,
  };
}

function judgeStub(agentId: string, modelFamily: string): RegistryAgent {
  return {
    agentId,
    modelFamily,
  } as RegistryAgent;
}

function pdfFacts(overrides: Partial<ArtifactFacts> = {}): ArtifactFacts {
  return {
    artifact_ref: "art_pdf",
    kind: "pdf",
    valid: true,
    pages: 1,
    text: "hello verification world",
    overflow_regions: 0,
    fonts_embedded: false,
    links: [],
    bytes: 200,
    observed_latency_ms: 10,
    declared_latency_ms: 10,
    title: "hello verification world",
    sections: [],
    has_viewport_meta: false,
    cta_selectors_found: [],
    metrics_found: [],
    filters_found: [],
    screenshots_count: 0,
    word_count: 3,
    has_lang: false,
    images_missing_alt: 0,
    has_primary_view: false,
    data_payload_nonempty: true,
    has_sources_section: false,
    broken_required_assets: [],
    ...overrides,
  };
}

describe("defaultRubricFor", () => {
  it("returns a dedicated rubric for each of the four task categories", () => {
    expect(defaultRubricFor("html_to_pdf").rubric_version).toBe("html_to_pdf@v0");
    expect(defaultRubricFor("landing_page").rubric_version).toBe("landing_page@v0");
    expect(defaultRubricFor("dashboard").rubric_version).toBe("dashboard@v0");
    expect(defaultRubricFor("research_report").rubric_version).toBe("research_report@v0");
    expect(defaultRubricFor("analista de investimentos").rubric_version).toBe("specialty_report@v0");
  });
});

describe("scopeChecks", () => {
  it("keeps the html_to_pdf demo checks when TASK_SPEC names PDF geometry", () => {
    const spec = scopeChecks(
      HTML_TO_PDF_RUBRIC,
      "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
      { category: "html_to_pdf" },
    );
    expect(checkIds(spec)).toEqual(HTML_TO_PDF_RUBRIC.checks.map((c) => c.check_id));
  });

  it("landing_page does not run or fail PDF margins / fonts / page_count when TASK_SPEC omits PDF geometry", () => {
    const spec = scopeChecks(LANDING_PAGE_RUBRIC, LANDING_TASK, { category: "landing_page", artifact_kind: "html" });
    const ids = checkIds(spec);
    expect(ids).not.toEqual(expect.arrayContaining(["fonts_embedded", "page_count", "no_layout_overflow", "pdf_valid"]));
    expect(ids).toEqual(expect.arrayContaining(["artifact_exists", "has_title", "has_primary_cta", "viewport_meta"]));
    expect(ids).not.toContain("has_sources_section");
  });

  it("research_report ignores CTA / landing checks", () => {
    const spec = scopeChecks(RESEARCH_REPORT_RUBRIC, RESEARCH_TASK, { category: "research_report", artifact_kind: "md" });
    const ids = checkIds(spec);
    expect(ids).not.toEqual(expect.arrayContaining(["has_primary_cta", "viewport_meta", "has_title"]));
    expect(ids).toEqual(expect.arrayContaining(["has_sources_section", "covers_brief_topics", "min_length"]));

    const leaked = scopeChecks(LANDING_PAGE_RUBRIC, RESEARCH_TASK, { category: "research_report", artifact_kind: "md" });
    expect(checkIds(leaked)).not.toContain("has_primary_cta");
  });

  it("PDF geometry words do not imply landing_page PDF checks unless a PDF is requested", () => {
    const withMargins = scopeChecks("landing_page", "Build a landing page with 2cm margins on A4 and embedded fonts.", {
      category: "landing_page",
      artifact_kind: "html",
    });
    expect(checkIds(withMargins)).not.toEqual(expect.arrayContaining(["page_count", "fonts_embedded"]));

    const withPdf = scopeChecks("landing_page", "Build a landing page and also export an optional PDF: A4, 2cm margins, fonts embedded.", {
      category: "landing_page",
      artifact_kind: "pdf",
    });
    expect(checkIds(withPdf)).toEqual(expect.arrayContaining(["artifact_exists"]));
  });
});

describe("out-of-scope criteria cannot cause fail", () => {
  it("an absent check_id is not evaluated and cannot flip the verdict", async () => {
    const source = parseSource(NEXUS_HTML, LANDING_TASK);
    const facts = await inspectArtifact(landingArtifact());
    const spec = scopeChecks("landing_page", LANDING_TASK, { category: "landing_page", artifact_kind: "html" });
    expect(checkIds(spec)).not.toContain("fonts_embedded");
    expect(facts.fonts_embedded).toBe(false);
    expect(facts.pages).toBe(0);

    const result = runChecks(spec, facts, source);
    expect(result.checks.map((c) => c.check_id)).not.toContain("fonts_embedded");
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.objective).toBe(1);
  });
});

describe("Nexus false-positive", () => {
  it("clean landing_page HTML that fails html_to_pdf PDF checks passes under landing_page scoping", async () => {
    const source = parseSource(NEXUS_HTML, LANDING_TASK);
    const facts = await inspectArtifact(landingArtifact());
    expect(facts.kind).toBe("html");
    expect(facts.valid).toBe(true);

    const wrong = runChecks(HTML_TO_PDF_RUBRIC, facts, source);
    expect(wrong.checks.filter((c) => !c.passed).map((c) => c.check_id)).toEqual(
      expect.arrayContaining(["pdf_valid", "fonts_embedded"]),
    );

    const scoped = scopeChecks("landing_page", LANDING_TASK, { category: "landing_page", artifact_kind: "html" });
    const right = runChecks(scoped, facts, source);
    expect(right.checks.map((c) => c.check_id)).not.toEqual(
      expect.arrayContaining(["pdf_valid", "fonts_embedded", "page_count"]),
    );
    expect(right.checks.every((c) => c.passed)).toBe(true);
    expect(right.objective).toBe(1);

    const j2 = judgeStub("j2-judge", "family-delta");
    expect(judgeFacts(j2, facts, source, scoped, "landing_page").verdict).toBe("pass");
  });
});

describe("research artifact", () => {
  it("passes research checks and does not evaluate CTAs", async () => {
    const source = parseSource(RESEARCH_MD, RESEARCH_TASK);
    const facts = await inspectArtifact(researchArtifact());
    const spec = scopeChecks("research_report", RESEARCH_TASK, { category: "research_report", artifact_kind: "md" });
    const result = runChecks(spec, facts, source);
    expect(result.checks.map((c) => c.check_id)).not.toContain("has_primary_cta");
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });
});

describe("J1/J2 disagreement withholds", () => {
  it("J2 is stricter on in-scope PDF fonts; disagreement withholds escrow", () => {
    const source: SourceDocument = parseSource("<p>hello verification world</p>", "Compile the brief to a PDF with text preserved.");
    const facts = pdfFacts({ text: source.text });
    const j1 = judgeStub("j1-judge", "family-beta");
    const j2 = judgeStub("j2-judge", "family-delta");

    expect(judgeFacts(j1, facts, source, SPECIALTY_REPORT_RUBRIC, TASK_CATEGORY).verdict).toBe("pass");
    expect(judgeFacts(j2, facts, source, SPECIALTY_REPORT_RUBRIC, TASK_CATEGORY).verdict).toBe("fail");

    const landingSpec = scopeChecks("landing_page", LANDING_TASK, { category: "landing_page" });
    expect(judgeFacts(j2, facts, source, landingSpec, "landing_page").reasons.join(" ")).not.toMatch(/font/i);

    const escrow = { minConfidence: 0.9 } as EscrowRow;
    expect(slaMet(escrow, { verdict: "pass", confidence: 0.99, judges_disagree: true })).toBe(false);
    expect(slaMet(escrow, { verdict: "pass", confidence: 0.99, judges_disagree: false })).toBe(true);
  });
});

describe("verifyArtifact + judgesFor", () => {
  let db: Db;

  beforeAll(async () => {
    process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
    ({ db } = await getDb());
  });

  it("judgesFor still filters by judge:${category} for all four categories", async () => {
    const registry = await loadRegistry(db, TASK_CATEGORY);
    for (const category of ["html_to_pdf", "landing_page", "dashboard", "research_report"]) {
      expect(judgesFor(registry, category).map((j) => j.agentId).sort()).toEqual(["j1-judge", "j2-judge"]);
    }
    expect(judgesFor(registry, "unknown_specialty")).toEqual([]);
  });

  it("J1/J2 disagreement sets judges_disagree and sla_verdict fail", async () => {
    const text = "hello verification world";
    const requirement = "Compile the brief to a PDF with text preserved and no layout overflow.";
    const html = `<html><body><p>${text}</p></body></html>`;
    const source = parseSource(html, requirement);
    const row = await createRequest(
      db,
      {
        task: { requirement, files: [{ name: "brief.html", media_type: "text/html", content: html }] },
        max_cost_usd: 0.05,
        max_latency_s: 30,
        min_confidence: 0.5,
        failure_policy: "refund",
        selection_timeout_s: 5,
        category: TASK_CATEGORY,
        verification: SPECIALTY_REPORT_RUBRIC,
      },
      { source: "tests/scoped-verification" },
    );
    const ctx = await buildContext(db, row.requestId);
    const planId = `plan_scoped_${row.requestId.slice(-8)}`;
    await db.insert(plans).values({
      planId,
      requestId: row.requestId,
      agentId: "c2-honest",
      deliverable: "pdf",
      promisedConfidence: 0.9,
      maxCostUsd: 0.04,
      estLatencyS: 8,
      chain: [{ agent_id: "c2-honest", role: "executor", subtask: "render", cost_usd: 0.04 }],
      rationale: "scoped disagreement fixture",
      planCostUsd: 0,
      stakeUsd: 0.008,
      strategyConsidered: ["self"],
      strategyChosen: "self",
      status: "validated",
    });

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 72, y: 720, size: 12, font });
    const bytes = await pdf.save();
    const artifact: DeliveryArtifact = {
      artifact_ref: "art_disagree",
      kind: "pdf",
      producer_agent_id: "c2-honest",
      pdf_base64: Buffer.from(bytes).toString("base64"),
      self_report: 0.9,
      observed_latency_ms: 8,
      declared_latency_ms: 8,
    };

    const facts = await inspectArtifact(artifact);
    const judging = await runJudges(ctx, {
      producer: getAgent(ctx.registry, "c2-honest"),
      chainAgentIds: ["c2-honest"],
      facts: { ...facts, fonts_embedded: false, overflow_regions: 0, text: source.text, valid: true },
      source,
      spec: SPECIALTY_REPORT_RUBRIC,
      parentEventId: null,
      taskRequirement: requirement,
      category: TASK_CATEGORY,
    });
    expect(judging.judges_disagree).toBe(true);
    expect(new Set(judging.judges.map((j) => j.verdict)).size).toBeGreaterThan(1);

    const outcome = await verifyArtifact(ctx, {
      artifact,
      source,
      producer: getAgent(ctx.registry, "c2-honest"),
      chainAgentIds: ["c2-honest"],
      planId,
      spec: SPECIALTY_REPORT_RUBRIC,
      artifactEventId: null,
      category: TASK_CATEGORY,
      taskRequirement: requirement,
    });
    if (outcome.judging.judges.length >= 2 && outcome.verification.verdict !== "fail") {
      expect(outcome.verification.judges_disagree).toBe(outcome.judging.judges_disagree);
      if (outcome.judging.judges_disagree) expect(outcome.sla_verdict).toBe("fail");
    }
    expect(
      slaMet({ minConfidence: row.minConfidence } as EscrowRow, {
        verdict: "pass",
        confidence: 0.99,
        judges_disagree: judging.judges_disagree,
      }),
    ).toBe(false);
  });
});
