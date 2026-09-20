import { describe, expect, it } from "vitest";
import { bytesToBase64, isPdfBytes, renderHtmlToPdf } from "../src/pdf";

describe("html_to_pdf renderer", () => {
  it("writes real PDF bytes that start with %PDF-", async () => {
    const html = `<!doctype html><html><body><h1>Hello</h1><p>See <a href="https://example.com/underwrite">docs</a>.</p></body></html>`;
    const bytes = await renderHtmlToPdf(html, "Compile input.html to a PDF: A4, 2cm margins, fonts embedded.");
    expect(isPdfBytes(bytes)).toBe(true);
    expect(bytesToBase64(bytes).length).toBeGreaterThan(20);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
