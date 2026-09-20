import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildZip, isZipBytes } from "../src/zip";

describe("in-Worker zip builder", () => {
  it("packs named files into a real ZIP", () => {
    const bytes = buildZip([
      { name: "report.md", content: "# Hold\n" },
      { name: "data.json", content: '{"ok":true}' },
    ]);
    expect(isZipBytes(bytes)).toBe(true);
    const files = unzipSync(bytes);
    expect(strFromU8(files["report.md"])).toContain("# Hold");
    expect(strFromU8(files["data.json"])).toContain("ok");
  });

  it("rejects an empty file list", () => {
    expect(() => buildZip([])).toThrow(/no files/i);
    expect(() => buildZip([{ name: "../x.md", content: "" }])).toThrow(/no files/i);
  });
});
