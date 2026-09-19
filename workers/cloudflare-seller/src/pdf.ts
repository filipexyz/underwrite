/**
 * HTML → real PDF bytes (pdf-lib + embedded Liberation Sans).
 * Underwrite inspects `artifact.pdf_base64` — it must start with %PDF- and
 * should keep source text, links, and embedded fonts so the judge can pass.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFString, type PDFFont, type PDFPage } from "pdf-lib";
import { LIBERATION_SANS_REGULAR_TTF_BASE64 } from "./font-data";
import { extractLinks, parseHtmlBlocks, stripHtml, type HtmlBlock, type InlineRun } from "./html";

const A4 = { width: 595.28, height: 841.89 };
const PT_PER_CM = 28.3465;
const CHARS_PER_PAGE = 3000;

const REPLACEMENTS: Record<string, string> = {
  "\u2014": "-",
  "\u2013": "-",
  "\u2192": "->",
  "\u2265": ">=",
  "\u00a0": " ",
  "\u201c": '"',
  "\u201d": '"',
  "\u2018": "'",
  "\u2019": "'",
  "\u2026": "...",
  "\u00d7": "x",
  "\u2022": "-",
};

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-";
}

function fitFontText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    const piece = REPLACEMENTS[ch] ?? ch;
    try {
      font.widthOfTextAtSize(piece, 10);
      out += piece;
    } catch {
      /* skip glyphs this subset cannot encode */
    }
  }
  return out;
}

function fontSizeFor(tag: HtmlBlock["tag"]): number {
  if (tag === "h1") return 16;
  if (tag === "h2") return 13;
  if (tag === "h3") return 12;
  return 10;
}

type Line = { runs: Array<{ text: string; href?: string; width: number }>; width: number; size: number };

function wrapBlock(block: HtmlBlock, font: PDFFont, maxWidth: number): Line[] {
  const size = fontSizeFor(block.tag);
  const lines: Line[] = [];
  let current: Line = { runs: [], width: 0, size };

  const pushRun = (text: string, href: string | undefined) => {
    const fitted = fitFontText(font, text);
    if (!fitted) return;
    const width = font.widthOfTextAtSize(fitted, size);
    if (current.width + width > maxWidth && current.runs.length > 0) {
      lines.push(current);
      current = { runs: [], width: 0, size };
    }
    current.runs.push({ text: fitted, href, width });
    current.width += width;
  };

  const pushWords = (run: InlineRun) => {
    const words = fitFontText(font, run.text)
      .split(/(\s+)/)
      .filter((w) => w.length > 0);
    for (const word of words) {
      if (word.trim() === "" && current.runs.length === 0) continue;
      pushRun(word, run.href);
    }
  };

  for (const run of block.inlines) pushWords(run);
  if (current.runs.length > 0) lines.push(current);
  return lines;
}

function addLink(page: PDFPage, href: string, x1: number, y1: number, x2: number, y2: number) {
  const annot = page.doc.context.register(
    page.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
    }),
  );
  page.node.addAnnot(annot);
}

export function parseSource(html: string, requirement: string) {
  const text = stripHtml(html);
  const margins = /(\d+(?:\.\d+)?)\s*cm\s*margins?/i.exec(requirement);
  return {
    html,
    text,
    links: extractLinks(html),
    expected_pages: Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)),
    margins_cm: margins ? Number(margins[1]) : 2,
  };
}

export async function renderHtmlToPdf(html: string, requirement: string): Promise<Uint8Array> {
  const source = parseSource(html, requirement);
  const blocks = parseHtmlBlocks(source.html);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(decodeBase64(LIBERATION_SANS_REGULAR_TTF_BASE64));

  const margin = source.margins_cm * PT_PER_CM;
  const contentWidth = A4.width - margin * 2;
  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - margin;

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - margin;
  };

  for (const block of blocks) {
    const lines = wrapBlock(block, font, contentWidth);
    const size = fontSizeFor(block.tag);
    const leading = size * 1.35;
    const gap = block.tag === "p" ? size * 0.6 : size * 0.45;
    if (y - leading < margin) newPage();
    for (const line of lines) {
      if (y - leading < margin) newPage();
      let x = margin;
      for (const run of line.runs) {
        page.drawText(run.text, { x, y: y - size, size, font });
        if (run.href) addLink(page, run.href, x, y - size - 2, x + run.width, y + 2);
        x += run.width;
      }
      y -= leading;
    }
    y -= gap;
  }

  pdf.setTitle("A4");
  pdf.setProducer("underwrite-cloudflare-seller");
  return pdf.save();
}
