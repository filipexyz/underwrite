/**
 * The verification rubric ships with the task (D-031): machine-readable,
 * versioned, declared in the request. A buyer that sends none gets the
 * category default below, and the ledger records which version judged it.
 */
import type { VerificationSpec } from "@/lib/contracts";

export const HTML_TO_PDF_RUBRIC: VerificationSpec = {
  rubric_version: "html_to_pdf@v0",
  /** Weighted share of checks that must pass. 1 = every check. */
  required_passing: 1,
  checks: [
    { check_id: "pdf_valid", weight: 1, description: "The artifact parses as a PDF document." },
    { check_id: "page_count", weight: 1, description: "Page count matches the source length at A4 with the requested margins." },
    { check_id: "text_matches_source", weight: 2, description: "Text extracted from the PDF covers the source text (≥ 98%)." },
    { check_id: "no_layout_overflow", weight: 2, description: "No content region overflows its page box." },
    { check_id: "fonts_embedded", weight: 1, description: "Every font used is embedded in the file." },
    { check_id: "links_preserved", weight: 1, description: "Every hyperlink in the source is present in the PDF." },
  ],
};

/** Lighter rubric for specialty fixtures that are still delivered as a PDF report. */
export const SPECIALTY_REPORT_RUBRIC: VerificationSpec = {
  rubric_version: "specialty_report@v0",
  required_passing: 1,
  checks: [
    { check_id: "pdf_valid", weight: 2, description: "The artifact parses as a PDF document." },
    { check_id: "text_matches_source", weight: 2, description: "Text extracted from the PDF covers the source brief." },
    { check_id: "no_layout_overflow", weight: 1, description: "No content region overflows its page box." },
  ],
};

const RUBRICS: Record<string, VerificationSpec> = {
  html_to_pdf: HTML_TO_PDF_RUBRIC,
};

export function defaultRubricFor(category: string): VerificationSpec {
  return RUBRICS[category] ?? SPECIALTY_REPORT_RUBRIC;
}
