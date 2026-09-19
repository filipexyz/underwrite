/**
 * HTML → real PDF bytes (pdf-lib).
 *
 * C1/C2 quality is still data-driven (D-014): `layout_overflow` writes a
 * defective PDF (clipped text, unembedded Helvetica, two runs outside the
 * page box). Checks read those bytes — they do not trust the producer.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFString, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExecutionPolicy } from "../types";
import type { SourceDocument } from "../artifact";
import { LIBERATION_SANS_REGULAR_TTF_BASE64 } from "./font-data";
import { clipBlocks, parseHtmlBlocks, type HtmlBlock, type InlineRun } from "./html";

const A4 = { width: 595.28, height: 841.89 };
const PT_PER_CM = 28.3465;

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

function fitFontText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    const piece = REPLACEMENTS[ch] ?? ch;
    try {
      font.widthOfTextAtSize(piece, 10);
      out += piece;
    } catch {
      /* skip glyphs this font cannot encode */
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
    const words = fitFontText(font, run.text).split(/(\s+)/).filter((w) => w.length > 0);
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

export async function renderHtmlToPdf(source: SourceDocument, policy: ExecutionPolicy): Promise<{ bytes: Uint8Array }> {
  const overflow = policy.quality === "layout_overflow";
  const parsed = parseHtmlBlocks(source.html);
  const fullText = parsed.flatMap((b) => b.inlines.map((r) => r.text)).join("");
  const blocks = overflow ? clipBlocks(parsed, Math.floor(fullText.length * 0.93)) : parsed;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = overflow
    ? await pdf.embedFont(StandardFonts.Helvetica)
    : await pdf.embedFont(Buffer.from(LIBERATION_SANS_REGULAR_TTF_BASE64, "base64"));

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

  if (overflow) {
    const mark = page;
    mark.drawText("OVERFLOW-A", { x: A4.width + 18, y: 220, size: 10, font });
    mark.drawText("OVERFLOW-B", { x: A4.width + 18, y: 180, size: 10, font });
  }

  // Keep the producer from smuggling a /NeedAppearances claim — facts come from bytes.
  pdf.setTitle(source.page_size);
  pdf.setProducer("underwrite-html-to-pdf");

  const bytes = await pdf.save();
  return { bytes };
}
