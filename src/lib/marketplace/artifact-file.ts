/**
 * How a stored deliverable is shown and served.
 *
 * The engine keeps the bytes on `requests.state.artifact`. The buyer task page and the ops
 * console both need the same facts (kind, size, producer, latency) and the same URL, so the
 * mapping lives here rather than being copied — a ZIP that decoded as UTF-8 text is how a file
 * "vanishes" even though the jsonb still has it.
 */

export const ARTIFACT_TYPES: Record<string, { mime: string; ext: string; field: string; encoding: "base64" | "utf8" }> = {
  pdf: { mime: "application/pdf", ext: "pdf", field: "pdf_base64", encoding: "base64" },
  html: { mime: "text/html; charset=utf-8", ext: "html", field: "html", encoding: "utf8" },
  md: { mime: "text/markdown; charset=utf-8", ext: "md", field: "markdown", encoding: "utf8" },
  markdown: { mime: "text/markdown; charset=utf-8", ext: "md", field: "markdown", encoding: "utf8" },
  zip: { mime: "application/zip", ext: "zip", field: "zip_base64", encoding: "base64" },
};

/** Artifact as it sits on request state — every field optional because a running or failed task may have none. */
export type StoredArtifact = {
  artifact_ref?: string;
  kind?: string;
  producer_agent_id?: string;
  observed_latency_ms?: number;
  declared_latency_ms?: number;
  pdf_base64?: string;
  html?: string;
  markdown?: string;
  zip_base64?: string;
};

export function artifactUrl(requestId: string): string {
  return `/api/v1/requests/${requestId}/artifact`;
}

/**
 * Buyer who paid, or an admin on the ops console. Anyone else gets the same 404 as a missing id,
 * so the response does not reveal that the request exists.
 */
export function canReadArtifact(
  identity: { userId: string; admin: boolean },
  buyerWalletId: string | null | undefined,
): boolean {
  if (identity.admin) return true;
  return Boolean(buyerWalletId) && buyerWalletId === identity.userId;
}

export function artifactTypeSpec(kind: string | undefined) {
  return kind ? ARTIFACT_TYPES[kind] : undefined;
}

export function encodeArtifactBytes(artifact: StoredArtifact): {
  bytes: Buffer;
  spec: (typeof ARTIFACT_TYPES)[string];
} | null {
  const spec = artifactTypeSpec(artifact.kind);
  if (!spec) return null;
  const payload = artifact[spec.field as keyof StoredArtifact];
  if (typeof payload !== "string" || payload.length === 0) return null;
  const bytes = spec.encoding === "base64" ? Buffer.from(payload, "base64") : Buffer.from(payload, "utf-8");
  return { bytes, spec };
}

export function artifactSize(artifact: StoredArtifact): number {
  return encodeArtifactBytes(artifact)?.bytes.byteLength ?? 0;
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function canPreviewInIframe(kind: string | undefined): kind is "html" | "pdf" {
  return kind === "html" || kind === "pdf";
}
