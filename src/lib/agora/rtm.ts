/**
 * One turn of the live transcript, as Agora delivers it.
 *
 * Declared here rather than imported: this is the Agora wire shape, and both features (the interview
 * pool and the signed-in task composer) validate it with their own zod schemas and are structurally
 * assignable to this. Depending on either feature's types here would invert the dependency.
 */
export type TranscriptTurn = {
  role: "user" | "assistant" | "system";
  text: string;
  at?: number;
  uid?: string;
  turn_id?: number;
};

export type ParsedRtm =
  | { kind: "transcript"; turn: TranscriptTurn; inProgress: boolean }
  | { kind: "state"; state: string }
  | { kind: "error"; message: string }
  | { kind: "other" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function decodePayload(raw: string | Uint8Array): unknown {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function objectName(value: Record<string, unknown>): string {
  const object = value.object ?? value.type ?? value.event_type;
  return typeof object === "string" ? object.toLowerCase() : "";
}

function readText(value: Record<string, unknown>): string {
  if (typeof value.text === "string") return value.text;
  if (typeof value.message === "string") return value.message;
  const payload = asRecord(value.payload);
  if (payload && typeof payload.text === "string") return payload.text;
  return "";
}

/**
 * Agora Conversational AI RTM payloads (`assistant.transcription`,
 * `user.transcription`, `message.state`, `message.error`). GPT Live may omit
 * user ASR; agent turns and state still arrive when `data_channel: rtm`.
 */
export function parseRtmMessage(raw: string | Uint8Array | unknown): ParsedRtm {
  const decoded = typeof raw === "string" || raw instanceof Uint8Array ? decodePayload(raw) : raw;
  const value = asRecord(decoded);
  if (!value) return { kind: "other" };

  const name = objectName(value);
  if (name.includes("error")) {
    const message = readText(value) || (typeof value.message === "string" ? value.message : "agent error");
    return { kind: "error", message };
  }

  if (name.includes("state") || name.startsWith("state.")) {
    const payload = asRecord(value.payload);
    const state =
      (typeof value.state === "string" && value.state) ||
      (typeof value.value === "string" && value.value) ||
      (payload && typeof payload.value === "string" && payload.value) ||
      name.replace(/^.*state[._]?/, "") ||
      "unknown";
    return { kind: "state", state };
  }

  if (name.includes("transcription") || (typeof value.text === "string" && value.text && (name.includes("assistant") || name.includes("user")))) {
    const isUser = name.includes("user");
    const turnStatus = typeof value.turn_status === "number" ? value.turn_status : value.final === false ? 0 : 1;
    const text = readText(value);
    if (!text.trim()) return { kind: "other" };
    return {
      kind: "transcript",
      inProgress: turnStatus === 0,
      turn: {
        role: isUser ? "user" : "assistant",
        text,
        at: typeof value.start_ms === "number" ? value.start_ms : Date.now(),
        uid: value.user_id !== undefined ? String(value.user_id) : undefined,
        turn_id: typeof value.turn_id === "number" ? value.turn_id : undefined,
      },
    };
  }

  return { kind: "other" };
}

/** Merge in-progress agent turns with the same turn_id; append completed ones. */
export function upsertTranscript(existing: TranscriptTurn[], incoming: TranscriptTurn, inProgress: boolean): TranscriptTurn[] {
  if (incoming.turn_id === undefined) {
    return inProgress ? [...existing.filter((t) => t.turn_id !== -1), { ...incoming, turn_id: -1 }] : [...existing.filter((t) => t.turn_id !== -1), incoming];
  }
  const idx = existing.findIndex((t) => t.turn_id === incoming.turn_id && t.role === incoming.role);
  if (idx === -1) return [...existing, incoming];
  const next = existing.slice();
  next[idx] = incoming;
  return next;
}
