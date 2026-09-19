/**
 * Inspection turns an artifact into observable facts. Checks read facts —
 * never the producer's claims — so swapping the simulated renderer for a real
 * one only touches this file (`inspectPdfBytes` with pdf.js / pdf-lib).
 */
import type { PdfArtifact } from "@/lib/marketplace/artifact";

export type ArtifactFacts = {
  artifact_ref: string;
  kind: "pdf";
  simulated: boolean;
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

export function inspectArtifact(artifact: PdfArtifact): ArtifactFacts {
  return {
    artifact_ref: artifact.artifact_ref,
    kind: artifact.kind,
    simulated: artifact.simulated,
    valid: artifact.valid,
    pages: artifact.pages,
    text: artifact.text,
    overflow_regions: artifact.overflow_regions,
    fonts_embedded: artifact.fonts_embedded,
    links: artifact.links,
    bytes: artifact.bytes,
    observed_latency_ms: artifact.observed_latency_ms,
    declared_latency_ms: artifact.declared_latency_ms,
  };
}

/**
 * Placeholder for real PDF inspection (next build-order step). Kept as a
 * typed seam so the checks and confidence code already compile against it.
 */
export async function inspectPdfBytes(bytes: Uint8Array): Promise<ArtifactFacts> {
  throw new Error(`real PDF inspection is not wired yet (${bytes.byteLength} bytes received) — see docs/NEXT.md`);
}
