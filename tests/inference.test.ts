import { afterEach, describe, expect, it } from "vitest";
import { POST as postRequest } from "@/app/api/v1/requests/route";
import { DEMO_REQUEST } from "@/lib/marketplace/requests";
import {
  InferenceNotConfiguredError,
  runInference,
  setInferenceTransportForTests,
} from "@/lib/observability/inference";

describe("runInference refuses to simulate", () => {
  afterEach(() => {
    setInferenceTransportForTests(async (req) => ({
      text: `[test] ${req.purpose} rationale`,
      inputTokens: 180,
      outputTokens: 60,
    }));
  });

  it("throws 503 when no provider key and no test transport", async () => {
    setInferenceTransportForTests(undefined);
    delete process.env.MODEL_PROVIDER_API_KEY;
    delete process.env.NEURALAKE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(
      runInference({
        agent_id: "a-delegator",
        purpose: "bid",
        prompt: "justify",
      }),
    ).rejects.toBeInstanceOf(InferenceNotConfiguredError);
  });

  it("POST /api/v1/requests returns 503 without a provider key", async () => {
    const res = await postRequest(
      new Request("http://localhost/api/v1/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(DEMO_REQUEST),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/MODEL_PROVIDER_API_KEY/);
    expect(body.error).toMatch(/Simulated inference is disabled/);
  });
});
