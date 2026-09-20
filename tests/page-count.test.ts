/**
 * A page count stated in the brief is a requirement; the fallback is an estimate.
 *
 * Conflating the two produced the false pass this guards against: a brief asked for a four-page translation,
 * the artifact was one page, and the check passed because a requirement was compared to a source-length
 * heuristic with a +/-1 tolerance.
 */
import { describe, expect, it } from "vitest";
import { impliedPageCount, parseSource } from "@/lib/marketplace/artifact";

describe("impliedPageCount", () => {
  it("reads a stated count in digits and in words", () => {
    expect(impliedPageCount("Translate all text in the supplied four-page Portuguese PDF")).toBe(4);
    expect(impliedPageCount("compile this into a 3-page PDF")).toBe(3);
    expect(impliedPageCount("monte um PDF de 4 páginas")).toBe(4);
    expect(impliedPageCount("duas páginas, por favor")).toBe(2);
  });

  it("returns nothing when the brief does not state one", () => {
    expect(impliedPageCount("Compile input.html to a PDF: A4, 2cm margins, fonts embedded")).toBeUndefined();
    // "2cm margins" must not be read as a page count.
    expect(impliedPageCount("PDF with 2cm margins")).toBeUndefined();
  });

  it("marks the expectation as stated, so the check can be exact", () => {
    const stated = parseSource("<p>hello world</p>", "translate the four-page PDF into English");
    expect(stated.expected_pages).toBe(4);
    expect(stated.pages_stated).toBe(true);

    const estimated = parseSource("<p>hello world</p>", "compile input.html to a PDF, A4, 2cm margins");
    expect(estimated.pages_stated).toBe(false);
    expect(estimated.expected_pages).toBeGreaterThanOrEqual(1);
  });
});
