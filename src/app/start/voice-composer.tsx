"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseRtmMessage, upsertTranscript, type TranscriptTurn } from "@/lib/agora/rtm";
import { VoiceTaskBrief } from "@/lib/voice/types";

type Phase = "idle" | "connecting" | "live" | "ending" | "done" | "error";

type StartPayload = {
  session_id: string;
  channel: string;
  token: string;
  uid: string;
  agent_uid: string;
  app_id?: string;
  agora_agent_id: string;
  expire_at: number;
  greeting: string;
  error?: string;
  details?: unknown;
};

type FinalizePayload = { request_id?: string; summary?: string; created?: boolean; error?: string };

/**
 * The signed-in voice composer.
 *
 * Own component, not the interview room: the two share Agora primitives and the visual language, but a
 * composer's job is different — it ends in a *posted task*, so the successful state is a task id and a
 * spoken summary rather than "thanks, you can close this tab".
 *
 * The brief is extracted from the agent's final JSON turn client-side, then re-validated by the server.
 * That keeps the agent's own declaration authoritative about *when* it is finished, while never letting
 * a malformed payload become a marketplace task.
 */
export function VoiceComposer({ startPath }: { startPath: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentState, setAgentState] = useState("idle");
  /** Whether the agent's audio track has been subscribed to. Silence without this is a bug, not a pause. */
  const [agentConnected, setAgentConnected] = useState(false);
  /**
   * Agora's own view of the call. Surfaced because three attempts to fix "no audio" by reasoning about
   * the code failed: without the agent console, these two numbers are the only way to tell
   * "the agent never joined" apart from "it joined and published nothing".
   */
  const [remoteCount, setRemoteCount] = useState(0);
  const [connState, setConnState] = useState("idle");
  /** Full provider error text from the agent, kept separately so it is never truncated by layout. */
  const [agentError, setAgentError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<{ requestId: string; summary: string } | null>(null);
  const router = useRouter();

  const rtcRef = useRef<import("agora-rtc-sdk-ng").IAgoraRTCClient | null>(null);
  const micRef = useRef<import("agora-rtc-sdk-ng").IMicrophoneAudioTrack | null>(null);
  const rtmRef = useRef<import("agora-rtm").RTMClient | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const finishing = useRef(false);
  const starting = useRef(false);
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const pushedRef = useRef(0);
  /** `user-left` fires outside React's render cycle; the handler needs the current phase. */
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = window.setInterval(() => {
      if (startedAtRef.current) setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const cleanup = useCallback(async () => {
    try {
      micRef.current?.stop();
      micRef.current?.close();
    } catch {
      /* ignore */
    }
    micRef.current = null;
    try {
      await rtcRef.current?.leave();
    } catch {
      /* ignore */
    }
    rtcRef.current = null;
    try {
      await rtmRef.current?.logout();
    } catch {
      /* ignore */
    }
    rtmRef.current = null;
  }, []);

  /** Push settled turns so the transcript survives a closed tab and the caller can watch it live. */
  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const timer = window.setInterval(() => {
      const settled = transcriptRef.current.filter((t) => t.turn_id !== -1);
      const from = pushedRef.current;
      if (settled.length <= from) return;
      const pending = settled.slice(from).slice(-60);
      pushedRef.current = settled.length;
      void fetch(`/api/v1/voice/sessions/${sessionId}/transcript`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript_json: pending }),
      })
        .then((res) => {
          if (!res.ok && res.status !== 409) pushedRef.current = from;
        })
        .catch(() => {
          pushedRef.current = from;
        });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [phase, sessionId]);

  const finish = useCallback(
    async (turns: TranscriptTurn[], brief?: VoiceTaskBrief) => {
      if (finishing.current || !sessionId) return;
      finishing.current = true;
      setPhase("ending");
      try {
        const res = await fetch(`/api/v1/voice/sessions/${sessionId}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The transcript is the payload that matters; the server extracts the brief from it.
          body: JSON.stringify({ transcript_json: turns, ...(brief ? { brief } : {}) }),
        });
        const body = (await res.json().catch(() => ({}))) as FinalizePayload;
        if (!res.ok || !body.request_id) {
          finishing.current = false;
          setPhase("live");
          setError(body.error ?? `could not post the task (${res.status})`);
          return;
        }
        await cleanup();
        setResult({ requestId: body.request_id, summary: body.summary ?? "" });
        setPhase("done");
        // Straight to following it — the agreement is readable there, so nothing is lost by not
        // lingering on a summary card.
        router.replace(`/tasks/${body.request_id}`);
      } catch (err) {
        finishing.current = false;
        setPhase("live");
        setError(err instanceof Error ? err.message : "could not post the task");
      }
    },
    [cleanup, sessionId],
  );

  /**
   * The happy path is fully automatic: the agent's closing sentence is the trigger.
   *
   * The prompt standardises that sentence ("I have everything and am posting the task"), so matching it
   * is a contract with our own instruction rather than a guess at the model's phrasing. A false positive
   * is safe: the server extracts the brief from the transcript and answers 409 if it is not actually
   * complete, which puts the call back to `live` and tells the person what is still missing.
   *
   * There is deliberately **no button**. A human step between the conversation and the market would undo
   * the point of the surface, and it is the only thing that would make `human_interventions` non-zero.
   */
  const maybeFinish = useCallback(
    (turns: TranscriptTurn[]) => {
      const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant" && t.turn_id !== -1);
      if (!lastAssistant) return;

      // If the agent happened to emit parseable structure, use it and skip the extraction call.
      const parsed = extractBriefJson(lastAssistant.text);
      const structured = parsed ? VoiceTaskBrief.safeParse(parsed) : null;
      if (structured?.success) {
        void finish(turns, structured.data);
        return;
      }

      if (isWrapUp(lastAssistant.text)) void finish(turns);
    },
    [finish],
  );

  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setError(null);
    setPhase("connecting");
    try {
      const res = await fetch(startPath, { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as StartPayload;
      if (!res.ok) {
        setPhase("error");
        setError(payload.error ?? `could not start the agent (${res.status})`);
        return;
      }
      setSessionId(payload.session_id);

      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      try {
        // Matches the interview room. Audio PTS affects playback timing and is easy to lose when the
        // call setup is duplicated instead of shared — which is exactly how this bug class arrived.
        (AgoraRTC as typeof AgoraRTC & { setParameter?: (k: string, v: unknown) => void }).setParameter?.(
          "ENABLE_AUDIO_PTS",
          true,
        );
      } catch {
        /* optional */
      }
      const mic = await AgoraRTC.createMicrophoneAudioTrack();
      micRef.current = mic;
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      rtcRef.current = client;
      /*
       * Subscribing to the agent's tracks is what makes it audible. Without these handlers the client
       * joins and publishes fine, RTM still delivers the transcript, and the call looks healthy while
       * the human hears nothing.
       *
       * `agentConnected` is driven by the audio subscription itself rather than a uid comparison: this
       * call has exactly one remote participant, so published audio *is* the agent — and a uid mismatch
       * must not be able to report "waiting for audio" while audio is in fact playing.
       */
      client.on("user-published", async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
          user.audioTrack?.play();
          setAgentConnected(true);
        }
      });
      client.on("user-unpublished", (_user, mediaType) => {
        if (mediaType === "audio") setAgentConnected(false);
      });
      client.on("user-left", () => {
        setRemoteCount((n) => Math.max(0, n - 1));
        setAgentConnected(false);
        // The agent leaving the channel is a protocol-level "we're done" — far more reliable than
        // waiting for a sentence we would have to pattern-match. The server reads the transcript.
        if (phaseRef.current === "live" && transcriptRef.current.length > 1) {
          void finish(transcriptRef.current);
        }
      });
      client.on("user-joined", () => setRemoteCount((n) => n + 1));
      client.on("connection-state-change", (state) => setConnState(String(state)));
      await client.join(payload.app_id ?? "", payload.channel, payload.token, Number(payload.uid));
      await client.publish([mic]);

      const AgoraRTM = (await import("agora-rtm")).default;
      const rtm = new AgoraRTM.RTM(payload.app_id ?? "", payload.uid);
      rtmRef.current = rtm;
      rtm.addEventListener("message", (event: { message: unknown }) => {
        const parsed = parseRtmMessage(event.message);
        if (parsed.kind === "state") setAgentState(parsed.state);
        if (parsed.kind === "error") {
          /*
           * The agent's failure arrives here and nowhere else — the server's `session.start()` already
           * resolved, so this message is the only account of *why* the agent never joined. Keep the full
           * text on screen and persist it, instead of a truncated line nobody can act on.
           */
          setError(`agent error: ${parsed.message}`);
          setAgentError(parsed.message);
        }
        if (parsed.kind === "transcript") {
          // Both sides are kept. Filtering to the agent's turns made the conversation look like
          // questions with no answers, which reads as a frozen call.
          setTranscript((prev) => {
            const next = upsertTranscript(prev, parsed.turn, parsed.inProgress);
            if (!parsed.inProgress && parsed.turn.role === "assistant") maybeFinish(next);
            return next;
          });
        }
      });
      await rtm.login({ token: payload.token });
      await rtm.subscribe(payload.channel);

      startedAtRef.current = Date.now();
      setPhase("live");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "could not start the conversation");
    } finally {
      starting.current = false;
    }
  }, [maybeFinish, startPath]);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    try {
      await micRef.current?.setEnabled(next);
      setMicOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "mic toggle failed");
    }
  }, [micOn]);

  if (phase === "done" && result) {
    return (
      <section className="border border-ink bg-paper p-6 flex flex-col gap-4 text-left">
        <p className="eyebrow !mb-0 !text-ink">task posted</p>
        <h2 className="font-sans text-xl font-semibold">Agents are bidding. Opening the task…</h2>
        <p className="font-sans text-sm text-[#53605a] leading-relaxed">{result.summary}</p>
        <Link href={`/tasks/${result.requestId}`} className="mono text-xs text-teal hover:underline">
          {result.requestId}
        </Link>
      </section>
    );
  }

  return (
    <section className="border border-line bg-paper flex flex-col">
      <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
        <span className={phase === "live" ? "live-dot" : "live-dot opacity-40"} aria-hidden />
        <p className="eyebrow !mb-0">
          {phase === "live" ? `${agentConnected ? agentState : "waiting for the agent's audio"} · ${elapsed}s` : phase}
        </p>
        {phase !== "idle" ? (
          <p className="mono text-[10px] text-muted">
            rtc {connState} · remotes {remoteCount} · audio {agentConnected ? "on" : "none"}
          </p>
        ) : null}
        {phase === "idle" ? (
          <p className="font-sans text-sm text-[#53605a] max-w-sm leading-relaxed">
            Tell the agent what you need delivered. It will ask for the price you will pay, how long you will wait,
            and the confidence you require — and it will push back if those numbers cannot all hold at once.
          </p>
        ) : null}
        {error ? <p className="font-sans text-sm text-danger max-w-sm">{error}</p> : null}
        {agentError ? (
          <pre className="mono text-[10px] text-danger text-left w-full overflow-x-auto whitespace-pre-wrap border border-danger/40 p-2">
            {agentError}
          </pre>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-4 px-6 pb-6">
        {phase === "idle" || phase === "error" ? (
          <button type="button" onClick={() => void start()} className="btn-ink">
            <span>Start talking</span>
            <strong>→</strong>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void toggleMic()}
            disabled={phase !== "live"}
            aria-pressed={!micOn}
            className={`size-16 rounded-full border border-ink font-mono text-[10px] uppercase tracking-wider disabled:opacity-40 ${
              micOn ? "bg-paper text-ink hover:bg-acid" : "bg-[#ffccb1] text-danger"
            }`}
          >
            {micOn ? "Mute" : "Unmute"}
          </button>
        )}

        {transcript.length > 0 ? (
          <details className="w-full border border-line bg-paper text-left" open>
            <summary className="cursor-pointer px-3 py-2 eyebrow !mb-0">Transcript</summary>
            <ol className="px-3 pb-3 flex flex-col gap-2 max-h-52 overflow-y-auto">
              {transcript.map((turn, i) => (
                <li key={`${turn.turn_id ?? i}-${turn.role}`} className="text-xs leading-relaxed">
                  <span className="mono text-muted">{turn.role === "user" ? "You" : "Agent"} · </span>
                  <span>{turn.text}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        {/*
         * No human control here. Completion is detected from the agent's own closing sentence and the
         * server decides whether the brief is complete — a manual "post" step would put a human between
         * the conversation and the market, which is the one thing this surface exists to remove.
         */}
      </div>
    </section>
  );
}

/**
 * Closing phrases the prompt asks the agent to use, plus the obvious Portuguese equivalents.
 *
 * A phrase list is a blunt instrument, and it is acceptable here **only** because a wrong answer is not
 * destructive: the server decides whether the brief is actually complete and rejects it if not, putting
 * the call back to `live` with the missing terms named. The alternative — never detecting completion —
 * needs a human press, which is the thing being removed.
 */
const WRAP_UP_MARKERS = [
  "posting the task",
  "post the task",
  "i have everything",
  "vou publicar a tarefa",
  "publicando a tarefa",
  "tenho tudo",
  "postando a tarefa",
];

export function isWrapUp(text: string): boolean {
  const lower = text.toLowerCase();
  return WRAP_UP_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Pull the brief JSON out of the agent's last spoken turn.
 *
 * Scans from the end for the outermost `{…}` so trailing speech after the JSON does not defeat the
 * parse, and returns null on anything unparseable — the server re-validates regardless.
 */
export function extractBriefJson(text: string): unknown | null {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  const start = text.lastIndexOf("{", end);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
