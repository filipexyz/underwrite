import { NextResponse } from "next/server";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getRequest } from "@/lib/marketplace/requests";

export const dynamic = "force-dynamic";

/** Artifact kinds as they come out of the engine, mapped to what a browser needs to render them. */
const TYPES: Record<string, { mime: string; ext: string; field: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf", field: "pdf_base64" },
  html: { mime: "text/html; charset=utf-8", ext: "html", field: "html" },
  md: { mime: "text/markdown; charset=utf-8", ext: "md", field: "markdown" },
  markdown: { mime: "text/markdown; charset=utf-8", ext: "md", field: "markdown" },
};

type StoredArtifact = {
  artifact_ref?: string;
  kind?: string;
  producer_agent_id?: string;
  pdf_base64?: string;
  html?: string;
  markdown?: string;
};

/**
 * `GET /api/v1/requests/[requestId]/artifact` — the thing the buyer actually paid for.
 *
 * The engine has always produced the bytes and kept them in the request state, but nothing ever served
 * them, so a completed task ended with a ledger and no file. Ownership is enforced the same way the task
 * page enforces it: the wallet that paid is the only one that can fetch it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const auth = await requireSignedInApi();
  if (!auth.ok) return auth.response;

  const { requestId } = await params;
  const { db } = await getDb();
  const request = await getRequest(db, requestId);
  if (!request || request.buyerWalletId !== auth.identity.userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const state = request.state as { artifact?: StoredArtifact } | null;
  const artifact = state?.artifact;
  const spec = artifact?.kind ? TYPES[artifact.kind] : undefined;
  if (!artifact || !spec) {
    return NextResponse.json({ error: "no_artifact", status: request.status }, { status: 404 });
  }

  const payload = artifact[spec.field as keyof StoredArtifact];
  if (typeof payload !== "string" || payload.length === 0) {
    return NextResponse.json({ error: "artifact_empty", kind: artifact.kind }, { status: 404 });
  }

  const bytes =
    artifact.kind === "pdf"
      ? Buffer.from(payload, "base64")
      : Buffer.from(payload, "utf-8");

  const name = `deliverable-${requestId}.${spec.ext}`;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": spec.mime,
      "content-length": String(bytes.byteLength),
      // Inline so the task page can show it; the same URL downloads with a right-click.
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
