import { strToU8, zipSync } from "fflate";

export type ZipFile = { name: string; content: string };

export function isZipBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function safeEntryName(name: string): string {
  return name.replace(/^\/+/, "").replace(/\.\.\//g, "").trim();
}

export function buildZip(files: ZipFile[]): Uint8Array {
  const record: Record<string, Uint8Array> = {};
  for (const file of files) {
    const name = safeEntryName(file.name);
    if (!name || !file.content) continue;
    record[name] = strToU8(file.content);
  }
  if (Object.keys(record).length === 0) throw new Error("zip has no files");
  return zipSync(record);
}
