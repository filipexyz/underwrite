/**
 * The marketplace MCP surface, actually executed.
 *
 * Written because the whole point of today's lesson is that "it compiles" is not evidence. This calls the
 * handler directly with real JSON-RPC bodies, so `initialize`, the scope-filtered `tools/list` and the
 * rejection paths are proved rather than asserted.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { POST as mcp } from "@/app/api/mcp/route";
import { getDb } from "@/lib/db/client";

function rpc(body: unknown) {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.MODEL_PROVIDER_API_KEY = process.env.MODEL_PROVIDER_API_KEY ?? "test-neuralake";
  const handle = await getDb();
  await handle.migrate();
});

describe("marketplace MCP", () => {
  it("completes the initialize handshake", async () => {
    const res = await mcp(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { protocolVersion?: string; serverInfo?: { name?: string } } };
    expect(body.result?.protocolVersion).toBeTruthy();
    expect(body.result?.serverInfo?.name).toBe("underwrite-marketplace");
  });

  it("advertises the buyer tools and not the seller ones for an unauthenticated caller", async () => {
    const res = await mcp(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const body = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toContain("post_task");
    expect(names).toContain("get_task");
    expect(names).toContain("watch_task");
    expect(names).toContain("discover_agents");
    // The filter, not just a guard: a buyer must not even see the seller side.
    expect(names).not.toContain("post_plan");
    expect(names).not.toContain("submit_deliverable");
  });

  it("rejects an unknown method and an unknown tool as protocol errors", async () => {
    const bad = await mcp(rpc({ jsonrpc: "2.0", id: 3, method: "nope", params: {} }));
    expect((await bad.json()).error?.code).toBe(-32601);

    const unknownTool = await mcp(rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rm_rf" } }));
    expect((await unknownTool.json()).error?.code).toBe(-32602);
  });

  it("refuses a seller tool from a buyer caller, as tool content", async () => {
    const res = await mcp(
      rpc({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "submit_deliverable", arguments: { request_id: "x", artifact: { pdf_base64: "a".repeat(30) } } },
      }),
    );
    const body = (await res.json()) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("may not call");
  });

  it("rejects a malformed body as a parse error", async () => {
    const res = await mcp(
      new Request("http://localhost:3000/api/mcp", { method: "POST", body: "not json" }),
    );
    expect((await res.json()).error?.code).toBe(-32700);
  });

  it("lists hireable agents for a specialty", async () => {
    const res = await mcp(
      rpc({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "discover_agents", arguments: { category: "html_to_pdf" } },
      }),
    );
    const body = (await res.json()) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    expect(body.result?.isError).toBeFalsy();
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as { agents?: unknown[] };
    expect(Array.isArray(payload.agents)).toBe(true);
  });
});
