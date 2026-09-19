/** Minimal HTML walk — same idea as Underwrite `src/lib/marketplace/pdf/html.ts`. */

export type InlineRun = { text: string; href?: string };
export type HtmlBlock = { tag: "h1" | "h2" | "h3" | "p"; inlines: InlineRun[] };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (raw, name: string) => {
    const key = name.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : raw;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : raw;
    }
    return ENTITIES[key] ?? raw;
  });
}

export function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function extractBody(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(cleaned);
  if (body) return body[1];
  return cleaned
    .replace(/<!doctype[^>]*>/i, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/i, "");
}

export function parseInlines(raw: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const before = collapseWs(decodeEntities(stripTags(raw.slice(last, m.index))));
    if (before) runs.push({ text: before });
    const label = collapseWs(decodeEntities(stripTags(m[2])));
    if (label) runs.push({ text: label, href: m[1] });
    last = m.index + m[0].length;
  }
  const after = collapseWs(decodeEntities(stripTags(raw.slice(last))));
  if (after) runs.push({ text: after });
  return runs;
}

export function parseHtmlBlocks(html: string): HtmlBlock[] {
  const inner = extractBody(html);
  const blocks: HtmlBlock[] = [];
  const re = /<(h1|h2|h3|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const inlines = parseInlines(m[2]);
    if (inlines.length > 0) blocks.push({ tag: m[1].toLowerCase() as HtmlBlock["tag"], inlines });
  }
  if (blocks.length === 0) {
    const text = collapseWs(decodeEntities(stripTags(inner)));
    if (text) blocks.push({ tag: "p", inlines: [{ text }] });
  }
  return blocks;
}

export function stripHtml(html: string): string {
  return collapseWs(decodeEntities(stripTags(extractBody(html))));
}

export function extractLinks(html: string): string[] {
  const links: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return links;
}
