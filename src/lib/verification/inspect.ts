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
import { extractLinks, stripHtml, type ArtifactKind, type DeliveryArtifact } from "@/lib/marketplace/artifact";
import { isZipBytes, unzipEntries } from "@/lib/marketplace/zip";

export type ArtifactFacts = {
  artifact_ref: string;
  kind: ArtifactKind;
  valid: boolean;
  pages: number;
  text: string;
  overflow_regions: number;
  fonts_embedded: boolean;
  links: string[];
  bytes: number;
  observed_latency_ms: number;
  declared_latency_ms: number;
  title: string | null;
  sections: string[];
  has_viewport_meta: boolean;
  cta_selectors_found: string[];
  metrics_found: string[];
  filters_found: string[];
  screenshots_count: number;
  word_count: number;
  has_lang: boolean;
  images_missing_alt: number;
  has_primary_view: boolean;
  data_payload_nonempty: boolean;
  has_sources_section: boolean;
  broken_required_assets: string[];
  zip_entries: string[];
};

export type InspectMeta = {
  artifact_ref: string;
  observed_latency_ms: number;
  declared_latency_ms: number;
};

function wordCountOf(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function looksLikeSources(value: string): boolean {
  return /\b(sources?|citations?|references?|bibliography)\b/i.test(value);
}

const EMPTY_FACTS = (meta: InspectMeta, bytes: number, valid: boolean, kind: ArtifactKind = "pdf"): ArtifactFacts => ({
  artifact_ref: meta.artifact_ref,
  kind,
  valid,
  pages: 0,
  text: "",
  overflow_regions: 0,
  fonts_embedded: false,
  links: [],
  bytes,
  observed_latency_ms: meta.observed_latency_ms,
  declared_latency_ms: meta.declared_latency_ms,
  title: null,
  sections: [],
  has_viewport_meta: false,
  cta_selectors_found: [],
  metrics_found: [],
  filters_found: [],
  screenshots_count: 0,
  word_count: 0,
  has_lang: false,
  images_missing_alt: 0,
  has_primary_view: false,
  data_payload_nonempty: false,
  has_sources_section: false,
  broken_required_assets: [],
  zip_entries: [],
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

    const text = texts.join(" ").replace(/\s+/g, " ").trim();
    return {
      artifact_ref: meta.artifact_ref,
      kind: "pdf",
      valid: pages.length > 0,
      pages: pages.length,
      text,
      overflow_regions: overflow,
      fonts_embedded: fonts > 0 && embedded === fonts,
      links: [...new Set(links)],
      bytes: length,
      observed_latency_ms: meta.observed_latency_ms,
      declared_latency_ms: meta.declared_latency_ms,
      title: text ? text.slice(0, 80) : null,
      sections: [],
      has_viewport_meta: false,
      cta_selectors_found: [],
      metrics_found: [],
      filters_found: [],
      screenshots_count: 0,
      word_count: wordCountOf(text),
      has_lang: false,
      images_missing_alt: 0,
      has_primary_view: false,
      data_payload_nonempty: text.length > 0,
      has_sources_section: looksLikeSources(text),
      broken_required_assets: [],
      zip_entries: [],
    };
  } catch {
    return EMPTY_FACTS(meta, length, false);
  }
}

const CTA_COPY = /\b(get started|sign[\s-]?up|subscribe|buy now|start now|join|register|book|contact us|try|download|learn more|cta)\b/i;

function headingTexts(html: string): string[] {
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => stripHtml(m[1])).filter(Boolean);
}

function findCtas(html: string): string[] {
  const found: string[] = [];
  const tags = html.matchAll(/<(a|button)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi);
  for (const m of tags) {
    const name = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    const text = stripHtml(m[3]);
    const cls = /class\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] ?? "";
    if (name === "button" || /cta|btn|button/i.test(cls) || /role\s*=\s*["']button/i.test(attrs) || CTA_COPY.test(text)) {
      found.push(name === "button" ? "button" : /cta/i.test(cls) ? "a.cta" : `a:${text.slice(0, 40)}`);
    }
  }
  if (/<input\b[^>]*type\s*=\s*["']submit/i.test(html)) found.push("input[type=submit]");
  return [...new Set(found)];
}

function findMetrics(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/data-metric\s*=\s*["']([^"']+)["']/gi)) found.push(m[1]);
  for (const m of html.matchAll(/<(?:div|span|p|li|dd|td)\b[^>]*class\s*=\s*["'][^"']*\b(?:metric|kpi|stat)\b[^"']*["'][^>]*>([\s\S]*?)<\//gi)) {
    const text = stripHtml(m[1]);
    if (text) found.push(text.slice(0, 40));
  }
  return [...new Set(found)];
}

function findFilters(html: string): string[] {
  const found: string[] = [];
  if (/<select\b/i.test(html)) found.push("select");
  if (/<input\b[^>]*type\s*=\s*["']search/i.test(html)) found.push("input[type=search]");
  if (/data-filter\b/i.test(html) || /class\s*=\s*["'][^"']*\bfilter/i.test(html)) found.push("[data-filter]");
  return found;
}

function brokenAssets(html: string): string[] {
  const broken: string[] = [];
  const assets = html.matchAll(/<(img|script|link)\b([^>]*)\/?>/gi);
  for (const m of assets) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    const href = /(?:src|href)\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    const needs = tag === "link" ? /rel\s*=\s*["']stylesheet/i.test(attrs) : true;
    if (!needs) continue;
    if (href === undefined || href.trim() === "" || href === "#" || href.toLowerCase().startsWith("javascript:")) {
      broken.push(tag);
    }
  }
  return broken;
}

function inspectHtmlString(html: string, meta: InspectMeta): ArtifactFacts {
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ||
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
    null;
  const sections = headingTexts(html);
  const text = stripHtml(html);
  const images = [...html.matchAll(/<img\b([^>]*)\/?>/gi)];
  const imagesMissingAlt = images.filter((m) => !/\balt\s*=/i.test(m[1] ?? "")).length;
  const jsonBlocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const jsonNonempty = jsonBlocks.some((m) => {
    try {
      const parsed = JSON.parse(m[1]);
      return parsed && (Array.isArray(parsed) ? parsed.length > 0 : typeof parsed === "object" ? Object.keys(parsed).length > 0 : true);
    } catch {
      return m[1].trim().length > 0;
    }
  });
  const tableRows = (html.match(/<tr\b/gi) ?? []).length;
  const valid = /<!doctype html|<html\b|<body\b|<head\b/i.test(html) || (/<[a-z][\s\S]*>/i.test(html) && text.length > 0);

  return {
    ...EMPTY_FACTS(meta, html.length, valid, "html"),
    text,
    links: extractLinks(html),
    title,
    sections,
    has_viewport_meta: /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html),
    cta_selectors_found: findCtas(html),
    metrics_found: findMetrics(html),
    filters_found: findFilters(html),
    word_count: wordCountOf(text),
    has_lang: /<html\b[^>]*\blang\s*=/i.test(html),
    images_missing_alt: imagesMissingAlt,
    has_primary_view: /<main\b|role\s*=\s*["']main["']|class\s*=\s*["'][^"']*\b(dashboard|chart|panel|grid)\b|<table\b/i.test(html),
    data_payload_nonempty: jsonNonempty || tableRows > 1,
    has_sources_section: sections.some(looksLikeSources) || looksLikeSources(text),
    broken_required_assets: brokenAssets(html),
  };
}

function markdownLinks(md: string): string[] {
  return [...md.matchAll(/\[[^\]]*]\((https?:[^)\s]+)\)/g)].map((m) => m[1]);
}

function inspectMarkdownString(md: string, meta: InspectMeta): ArtifactFacts {
  const headings = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
  const text = md.replace(/\s+/g, " ").trim();
  return {
    ...EMPTY_FACTS(meta, md.length, md.trim().length > 0, "md"),
    text,
    links: markdownLinks(md),
    title: headings[0] ?? (text ? text.slice(0, 80) : null),
    sections: headings,
    word_count: wordCountOf(md),
    has_sources_section: headings.some(looksLikeSources) || looksLikeSources(md) || markdownLinks(md).length > 0,
    data_payload_nonempty: md.trim().length > 0,
  };
}

function inspectMetaOf(artifact: DeliveryArtifact): InspectMeta {
  return {
    artifact_ref: artifact.artifact_ref,
    observed_latency_ms: artifact.observed_latency_ms,
    declared_latency_ms: artifact.declared_latency_ms,
  };
}

function inspectZipBytes(bytes: Uint8Array, meta: InspectMeta): ArtifactFacts {
  if (!isZipBytes(bytes)) return EMPTY_FACTS(meta, bytes.byteLength, false, "zip");
  try {
    const entries = unzipEntries(bytes);
    if (entries.length === 0) return { ...EMPTY_FACTS(meta, bytes.byteLength, false, "zip"), zip_entries: [] };
    const names = entries.map((e) => e.name);
    const textParts = entries.map((e) => e.text).filter((t): t is string => Boolean(t?.trim()));
    const text = textParts.join("\n").replace(/\s+/g, " ").trim();
    const htmlEntry = entries.find((e) => /\.html?$/i.test(e.name) && e.text);
    const mdEntry = entries.find((e) => /\.md$/i.test(e.name) && e.text);
    const probe = htmlEntry?.text
      ? inspectHtmlString(htmlEntry.text, meta)
      : mdEntry?.text
        ? inspectMarkdownString(mdEntry.text, meta)
        : null;
    const jsonNonempty = entries.some((e) => /\.json$/i.test(e.name) && Boolean(e.text?.trim()));
    return {
      ...(probe ?? EMPTY_FACTS(meta, bytes.byteLength, true, "zip")),
      kind: "zip",
      valid: true,
      bytes: bytes.byteLength,
      text: text || probe?.text || "",
      word_count: wordCountOf(text || probe?.text || ""),
      data_payload_nonempty: jsonNonempty || Boolean(probe?.data_payload_nonempty),
      zip_entries: names,
    };
  } catch {
    return EMPTY_FACTS(meta, bytes.byteLength, false, "zip");
  }
}

export async function inspectArtifact(artifact: DeliveryArtifact): Promise<ArtifactFacts> {
  const meta = inspectMetaOf(artifact);
  const screenshots = artifact.screenshots?.length ?? 0;
  const withShots = (facts: ArtifactFacts): ArtifactFacts => ({ ...facts, screenshots_count: screenshots });

  if (artifact.kind === "zip" || artifact.zip_base64) {
    const bytes = new Uint8Array(Buffer.from((artifact.zip_base64 ?? "").replace(/\s+/g, ""), "base64"));
    return withShots(inspectZipBytes(bytes, meta));
  }
  if (artifact.kind === "html" || (artifact.html && artifact.kind !== "pdf" && artifact.kind !== "md")) {
    return withShots(inspectHtmlString(artifact.html ?? "", meta));
  }
  if (artifact.kind === "md" || artifact.markdown) {
    return withShots(inspectMarkdownString(artifact.markdown ?? "", meta));
  }
  if (artifact.pdf_base64) {
    const bytes = new Uint8Array(Buffer.from(artifact.pdf_base64, "base64"));
    return withShots(await inspectPdfBytes(bytes, meta));
  }
  if (artifact.html) return withShots(inspectHtmlString(artifact.html, meta));
  return EMPTY_FACTS(meta, 0, false, artifact.kind);
}
