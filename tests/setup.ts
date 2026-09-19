import { setInferenceTransportForTests } from "@/lib/observability/inference";

/** HTTP-boundary mock. Production `runInference` never takes this branch. */
setInferenceTransportForTests(async (req) => ({
  text: `[test] ${req.purpose} rationale`,
  inputTokens: 180,
  outputTokens: 60,
}));
