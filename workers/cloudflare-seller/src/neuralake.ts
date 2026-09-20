/**
 * OpenAI-compatible Chat Completions against NeuraLake (seller BYOK).
 * Default base: https://api.neuralake.cloud/v1  model=auto
 * Cloudflare AI Gateway is not used.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletionResult = {
  text: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
};

export class NeuralakeError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "NeuralakeError";
    this.status = status;
  }
}

export async function chatCompletion(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  console.log(
    JSON.stringify({
      service: "cloudflare-seller",
      ts: new Date().toISOString(),
      msg: "neuralake_call",
      url,
      model: args.model,
    }),
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens ?? 400,
      temperature: 0.2,
    }),
    signal: args.signal,
  });
  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const detail =
      typeof parsed === "object" && parsed && "error" in parsed
        ? JSON.stringify((parsed as { error: unknown }).error)
        : raw.slice(0, 400);
    console.error(
      JSON.stringify({
        service: "cloudflare-seller",
        ts: new Date().toISOString(),
        msg: "neuralake_result",
        url,
        model: args.model,
        status: res.status,
        ok: false,
        detail: detail.slice(0, 400),
      }),
    );
    throw new NeuralakeError(`NeuraLake ${res.status}: ${detail || res.statusText}`, res.status);
  }
  const row = parsed as {
    model?: string;
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = row.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => part.text ?? "").join("")
    : (content ?? "");
  if (!text.trim()) throw new NeuralakeError("NeuraLake returned an empty completion", res.status);
  console.log(
    JSON.stringify({
      service: "cloudflare-seller",
      ts: new Date().toISOString(),
      msg: "neuralake_result",
      url,
      model: row.model ?? args.model,
      status: res.status,
      ok: true,
      chars: text.trim().length,
      tokens_in: row.usage?.prompt_tokens ?? 0,
      tokens_out: row.usage?.completion_tokens ?? 0,
    }),
  );
  return {
    text: text.trim(),
    model: row.model ?? args.model,
    tokens_in: row.usage?.prompt_tokens ?? 0,
    tokens_out: row.usage?.completion_tokens ?? 0,
  };
}

export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new NeuralakeError("model output did not contain a JSON object");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}
