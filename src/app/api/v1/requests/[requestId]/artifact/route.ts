import { NextResponse } from "next/server";
import { requireSignedInApi } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { artifactTypeSpec, canReadArtifact, encodeArtifactBytes, type StoredArtifact } from "@/lib/marketplace/artifact-file";
import { getRequest } from "@/lib/marketplace/requests";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/requests/[requestId]/artifact` — the thing the buyer actually paid for.
 *
 * The engine has always produced the bytes and kept them in the request state, but nothing ever served
 * them, so a completed task ended with a ledger and no file. The wallet that paid can fetch it; an
 * admin on `/console/requests/[id]` can too, otherwise the ops page would link at a 404 and the file
 * would look like it vanished.
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
  if (!request || !canReadArtifact(auth.identity, request.buyerWalletId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const state = request.state as { artifact?: StoredArtifact } | null;
  const artifact = state?.artifact;
  const spec = artifactTypeSpec(artifact?.kind);
  if (!artifact || !spec) {
    return NextResponse.json({ error: "no_artifact", status: request.status }, { status: 404 });
  }

  const encoded = encodeArtifactBytes(artifact);
  if (!encoded) {
    return NextResponse.json({ error: "artifact_empty", kind: artifact.kind }, { status: 404 });
  }

  const name = `deliverable-${requestId}.${encoded.spec.ext}`;
  return new NextResponse(new Uint8Array(encoded.bytes), {
    status: 200,
    headers: {
      "content-type": encoded.spec.mime,
      "content-length": String(encoded.bytes.byteLength),
      // Inline so the task page and the console can show it; the same URL downloads with a right-click.
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
