/**
 * Inspection turns PDF bytes into observable facts. Checks read these facts —
 * never the producer's claims.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  type PDFPage,
} from "pdf-lib";
import type { PdfArtifact } from "@/lib/marketplace/artifact";

export type ArtifactFacts = {
  artifact_ref: string;
  kind: "pdf";
  valid: boolean;
  pages: number;
  text: string;
  overflow_regions: number;
  fonts_embedded: boolean;
  links: string[];
  bytes: number;
  observed_latency_ms: number;
  declared_latency_ms: number;
};

export type InspectMeta = {
  artifact_ref: string;
  observed_latency_ms: number;
  declared_latency_ms: number;
};

const EMPTY_FACTS = (meta: InspectMeta, bytes: number, valid: boolean): ArtifactFacts => ({
  artifact_ref: meta.artifact_ref,
  kind: "pdf",
  valid,
  pages: 0,
  text: "",
  overflow_regions: 0,
  fonts_embedded: false,
  links: [],
  bytes,
  observed_latency_ms: meta.observed_latency_ms,
  declared_latency_ms: meta.declared_latency_ms,
});

function asDict(value: unknown): PDFDict | null {
  if (value instanceof PDFDict) return value;
  return null;
}

function lookupMaybe(dict: PDFDict, name: string): unknown {
  try {
    return dict.lookup(PDFName.of(name));
  } catch {
    return undefined;
  }
}

function streamText(value: unknown): string {
  if (!(value instanceof PDFRawStream)) return "";
  try {
    return new TextDecoder("latin1").decode(decodePDFRawStream(value).decode());
  } catch {
    return "";
  }
}

function pdfString(value: unknown): string {
  if (value instanceof PDFString) return value.decodeText();
  if (value instanceof PDFHexString) return value.decodeText();
  return "";
}

function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToInt = (h: string) => Number.parseInt(h, 16);
  const hexToChars = (h: string) => {
    const bytes = h.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i < bytes.length; i += 4) {
      const code = Number.parseInt(bytes.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code) out += String.fromCodePoint(code);
    }
    return out;
  };

  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  let block: RegExpExecArray | null;
  while ((block = bfchar.exec(cmap)) !== null) {
    const pair = /<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi;
    let m: RegExpExecArray | null;
    while ((m = pair.exec(block[1])) !== null) map.set(hexToInt(m[1]), hexToChars(m[2]));
  }

  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrange.exec(cmap)) !== null) {
    const sequential = /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi;
    let m: RegExpExecArray | null;
    while ((m = sequential.exec(block[1])) !== null) {
      const start = hexToInt(m[1]);
      const end = hexToInt(m[2]);
      let dest = hexToInt(m[3]);
      for (let cid = start; cid <= end; cid += 1) {
        map.set(cid, String.fromCodePoint(dest));
        dest += 1;
      }
    }
  }
  return map;
}

function fontToUnicode(font: PDFDict): Map<number, string> {
  const toUni = lookupMaybe(font, "ToUnicode");
  const cmap = streamText(toUni);
  return cmap ? parseToUnicode(cmap) : new Map();
}

function fontDescriptorHasFile(desc: PDFDict | null): boolean {
  if (!desc) return false;
  return Boolean(lookupMaybe(desc, "FontFile") ?? lookupMaybe(desc, "FontFile2") ?? lookupMaybe(desc, "FontFile3"));
}

function fontIsEmbedded(font: PDFDict): boolean {
  if (fontDescriptorHasFile(asDict(lookupMaybe(font, "FontDescriptor")))) return true;
  const descendants = lookupMaybe(font, "DescendantFonts");
  const descendantItems = descendants instanceof PDFArray ? descendants.asArray() : [];
  for (const item of descendantItems) {
    const child = item instanceof PDFRef ? font.context.lookup(item) : item;
    const childDict = asDict(child);
    if (childDict && fontDescriptorHasFile(asDict(lookupMaybe(childDict, "FontDescriptor")))) return true;
  }
  return false;
}

function pageFonts(page: PDFPage): Map<string, { embedded: boolean; toUnicode: Map<number, string> }> {
  const out = new Map<string, { embedded: boolean; toUnicode: Map<number, string> }>();
  const resources = asDict(lookupMaybe(page.node, "Resources")) ?? asDict(page.node.Resources());
  if (!resources) return out;
  const fonts = asDict(lookupMaybe(resources, "Font"));
  if (!fonts) return out;
  for (const [name, ref] of fonts.entries()) {
    const dict = asDict(ref instanceof PDFRef ? fonts.context.lookup(ref) : ref);
    if (!dict) continue;
    out.set(String(name).replace(/^\//, ""), {
      embedded: fontIsEmbedded(dict),
      toUnicode: fontToUnicode(dict),
    });
  }
  return out;
}

function pageLinks(page: PDFPage): string[] {
  const links: string[] = [];
  const annots = page.node.Annots();
  if (!(annots instanceof PDFArray)) return links;
  for (const item of annots.asArray()) {
    const dict = asDict(item instanceof PDFRef ? page.doc.context.lookup(item) : item);
    if (!dict) continue;
    const subtype = lookupMaybe(dict, "Subtype");
    if (String(subtype) !== "/Link") continue;
    const action = asDict(lookupMaybe(dict, "A"));
    if (!action) continue;
    const uri = pdfString(lookupMaybe(action, "URI"));
    if (uri) links.push(uri);
  }
  return links;
}

function pageContent(page: PDFPage): string {
  const contents = page.node.Contents();
  if (!contents) return "";
  const chunks: string[] = [];
  const push = (value: unknown) => {
    const stream = value instanceof PDFRef ? page.doc.context.lookup(value) : value;
    const text = streamText(stream);
    if (text) chunks.push(text);
  };
  if (contents instanceof PDFArray) {
    for (const item of contents.asArray()) push(item);
  } else {
    push(contents);
  }
  return chunks.join("\n");
}

function decodeLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === "n") {
      out += "\n";
      i += 1;
    } else if (next === "r") {
      out += "\r";
      i += 1;
    } else if (next === "t") {
      out += "\t";
      i += 1;
    } else if (next === "b") {
      out += "\b";
      i += 1;
    } else if (next === "f") {
      out += "\f";
      i += 1;
    } else if (next === "(" || next === ")" || next === "\\") {
      out += next;
      i += 1;
    } else if (next && next >= "0" && next <= "7") {
      let oct = next;
      let eaten = 1;
      if (raw[i + 2] >= "0" && raw[i + 2] <= "7") {
        oct += raw[i + 2];
        eaten += 1;
      }
      if (raw[i + 1 + eaten] >= "0" && raw[i + 1 + eaten] <= "7") {
        oct += raw[i + 1 + eaten];
        eaten += 1;
      }
      out += String.fromCharCode(Number.parseInt(oct, 8));
      i += eaten;
    } else if (next !== undefined) {
      out += next;
      i += 1;
    }
  }
  return out;
}

function decodeHex(hex: string, toUnicode: Map<number, string>): string {
  const clean = hex.replace(/\s+/g, "");
  if (toUnicode.size > 0) {
    let out = "";
    const width = [...toUnicode.keys()].reduce((max, k) => Math.max(max, k.toString(16).length), 4);
    const step = width % 2 === 0 ? width : 4;
    for (let i = 0; i < clean.length; i += step) {
      const cid = Number.parseInt(clean.slice(i, i + step), 16);
      out += toUnicode.get(cid) ?? "";
    }
    return out;
  }
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

type TextRun = { text: string; x: number; y: number; size: number };

function extractRuns(content: string, fonts: Map<string, { embedded: boolean; toUnicode: Map<number, string> }>): TextRun[] {
  const runs: TextRun[] = [];
  let fontKey = "";
  let size = 10;
  let x = 0;
  let y = 0;
  const numbers: number[] = [];

  const takeNumber = (n: number) => numbers.splice(Math.max(0, numbers.length - n), n);

  const emit = (text: string) => {
    if (text) runs.push({ text, x, y, size });
  };

  const toUnicode = () => fonts.get(fontKey)?.toUnicode ?? new Map();

  for (let i = 0; i < content.length; ) {
    const ch = content[i];
    if (ch <= " ") {
      i += 1;
      continue;
    }
    if (ch === "/") {
      let j = i + 1;
      while (j < content.length && /[A-Za-z0-9+,#\-\.]/.test(content[j])) j += 1;
      fontKey = content.slice(i + 1, j);
      i = j;
      continue;
    }
    if (ch === "(") {
      let j = i + 1;
      let raw = "";
      while (j < content.length) {
        if (content[j] === "\\" && j + 1 < content.length) {
          raw += content[j] + content[j + 1];
          j += 2;
          continue;
        }
        if (content[j] === ")") break;
        raw += content[j];
        j += 1;
      }
      emit(decodeLiteral(raw));
      i = j + 1;
      continue;
    }
    if (ch === "<" && content[i + 1] !== "<") {
      let j = i + 1;
      while (j < content.length && content[j] !== ">") j += 1;
      emit(decodeHex(content.slice(i + 1, j), toUnicode()));
      i = j + 1;
      continue;
    }
    if (/[-0-9.]/.test(ch)) {
      const m = /^-?\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(content.slice(i));
      if (m) {
        numbers.push(Number(m[0]));
        i += m[0].length;
        continue;
      }
    }
    const rest = content.slice(i);
    if (rest.startsWith("Tm") && numbers.length >= 6) {
      const six = takeNumber(6);
      x = six[4];
      y = six[5];
      i += 2;
      continue;
    }
    if ((rest.startsWith("Td") || rest.startsWith("TD")) && numbers.length >= 2) {
      const two = takeNumber(2);
      x += two[0];
      y += two[1];
      i += 2;
      continue;
    }
    if (rest.startsWith("Tf") && numbers.length >= 1) {
      size = takeNumber(1)[0] ?? size;
      i += 2;
      continue;
    }
    if (rest.startsWith("Tj") || rest.startsWith("ET") || rest.startsWith("BT") || rest.startsWith("TJ")) {
      numbers.length = 0;
      i += 2;
      continue;
    }
    i += 1;
  }
  return runs;
}

function countOverflow(runs: TextRun[], width: number, height: number): number {
  const epsilon = 1.5;
  return runs.filter((run) => run.x < -epsilon || run.y < -epsilon || run.x > width + epsilon || run.y > height + epsilon)
    .length;
}

export async function inspectPdfBytes(bytes: Uint8Array, meta: InspectMeta): Promise<ArtifactFacts> {
  const length = bytes.byteLength;
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (header !== "%PDF-") return EMPTY_FACTS(meta, length, false);

  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pages = pdf.getPages();
    const texts: string[] = [];
    const links: string[] = [];
    let overflow = 0;
    let fonts = 0;
    let embedded = 0;

    for (const page of pages) {
      const { width, height } = page.getSize();
      const fontMap = pageFonts(page);
      for (const info of fontMap.values()) {
        fonts += 1;
        if (info.embedded) embedded += 1;
      }
      const runs = extractRuns(pageContent(page), fontMap);
      overflow += countOverflow(runs, width, height);
      const pageText = runs.map((r) => r.text).join(" ");
      if (pageText) texts.push(pageText);
      links.push(...pageLinks(page));
    }

    return {
      artifact_ref: meta.artifact_ref,
      kind: "pdf",
      valid: pages.length > 0,
      pages: pages.length,
      text: texts.join(" ").replace(/\s+/g, " ").trim(),
      overflow_regions: overflow,
      fonts_embedded: fonts > 0 && embedded === fonts,
      links: [...new Set(links)],
      bytes: length,
      observed_latency_ms: meta.observed_latency_ms,
      declared_latency_ms: meta.declared_latency_ms,
    };
  } catch {
    return EMPTY_FACTS(meta, length, false);
  }
}

export async function inspectArtifact(artifact: PdfArtifact): Promise<ArtifactFacts> {
  const bytes = new Uint8Array(Buffer.from(artifact.pdf_base64, "base64"));
  return inspectPdfBytes(bytes, {
    artifact_ref: artifact.artifact_ref,
    observed_latency_ms: artifact.observed_latency_ms,
    declared_latency_ms: artifact.declared_latency_ms,
  });
}
