/** ZIP helpers for push deliverables. Bytes live on the request jsonb — no object store. */
import { strFromU8, unzipSync } from "fflate";

export function isZipBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export type ZipEntry = { name: string; bytes: Uint8Array; text: string | null };

const TEXT_EXT = /\.(md|html?|txt|json|csv|svg|css|js|ts|xml)$/i;

export function unzipEntries(bytes: Uint8Array): ZipEntry[] {
  const files = unzipSync(bytes);
  const entries: ZipEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (!name || name.endsWith("/")) continue;
    const text = TEXT_EXT.test(name) ? strFromU8(data) : null;
    entries.push({ name, bytes: data, text });
  }
  return entries;
}

export function impliedZipEntries(requirement: string): string[] {
  const found = [...requirement.matchAll(/\b([A-Za-z0-9._-]+\.(?:md|html?|json|csv|txt|png|svg))\b/g)];
  return [...new Set(found.map((m) => m[1]))];
}
