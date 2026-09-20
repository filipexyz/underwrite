import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TYPES,
  artifactSize,
  artifactUrl,
  canReadArtifact,
  encodeArtifactBytes,
  humanBytes,
} from "@/lib/marketplace/artifact-file";

describe("artifact serving", () => {
  it("maps zip to application/zip and decodes zip_base64", () => {
    expect(ARTIFACT_TYPES.zip).toEqual({
      mime: "application/zip",
      ext: "zip",
      field: "zip_base64",
      encoding: "base64",
    });
    const zip = Buffer.from("PK\u0003\u0004hello");
    const encoded = encodeArtifactBytes({ kind: "zip", zip_base64: zip.toString("base64") });
    expect(encoded?.spec.mime).toBe("application/zip");
    expect(encoded?.bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(artifactSize({ kind: "zip", zip_base64: zip.toString("base64") })).toBe(zip.byteLength);
  });

  it("serves html as utf-8 text, not base64", () => {
    const html = "<!doctype html><h1>Brief</h1>";
    const encoded = encodeArtifactBytes({ kind: "html", html });
    expect(encoded?.spec.mime).toMatch(/^text\/html/);
    expect(encoded?.bytes.toString("utf8")).toBe(html);
  });

  it("lets the buyer or an admin read, and hides the id from everyone else", () => {
    expect(canReadArtifact({ userId: "buyer-1", admin: false }, "buyer-1")).toBe(true);
    expect(canReadArtifact({ userId: "ops", admin: true }, "buyer-1")).toBe(true);
    expect(canReadArtifact({ userId: "stranger", admin: false }, "buyer-1")).toBe(false);
    expect(canReadArtifact({ userId: "stranger", admin: false }, null)).toBe(false);
  });

  it("formats size and the download path the pages link to", () => {
    expect(humanBytes(512)).toBe("512 B");
    expect(artifactUrl("req_b0a003a72aee47db9327")).toBe("/api/v1/requests/req_b0a003a72aee47db9327/artifact");
  });
});

describe("ops console request page", () => {
  it("surfaces the stored deliverable the way the task page does", () => {
    const source = readFileSync("src/app/console/requests/[id]/page.tsx", "utf8");
    expect(source).toContain("DELIVERABLE");
    expect(source).toContain("artifactUrl");
    expect(source).toContain("Download");
    expect(source).toContain("iframe");
    expect(source).toContain("canPreviewInIframe");
  });

  it("keeps the artifact route under the same [id] slug as the request API", () => {
    expect(existsSync("src/app/api/v1/requests/[id]/artifact/route.ts")).toBe(true);
    expect(existsSync("src/app/api/v1/requests/[requestId]/artifact/route.ts")).toBe(false);
  });
});
