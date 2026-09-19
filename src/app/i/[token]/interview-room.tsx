"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractAnswersFromTranscript } from "@/lib/interviews/extract";
import { parseRtmMessage, upsertTranscript } from "@/lib/interviews/rtm";
import type { TranscriptTurn } from "@/lib/interviews/types";

type StartPayload = {
  channel: string;
  token: string;
  uid: string;
  agent_uid: string;
  app_id: string;
  error?: string;
  details?: unknown;
};

function statusLabel(phase: string, agentState: string, agentConnected: boolean): string {
  if (phase === "connecting") return "connecting";
  if (phase === "ending") return "saving";
  if (phase === "thanks") return "done";
  if (phase !== "live") return "ready";
  if (!agentConnected) return "waiting";
  if (agentState === "listening" || agentState === "idle" || agentState === "silent") return "listening";
  if (agentState === "thinking") return "thinking";
  if (agentState === "speaking") return "speaking";
  return agentState || "listening";
}

export function InterviewRoom({
  startPath,
  finalizePath,
  appId,
  requiredFields,
}: {
  startPath: string;
  finalizePath: string;
  appId: string;
  requiredFields: string[];
}) {
  const [phase, setPhase] = useState<"idle" | "connecting" | "live" | "ending" | "thanks">("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentState, setAgentState] = useState("idle");
  const [micOn, setMicOn] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [joined, setJoined] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const rtcRef = useRef<import("agora-rtc-sdk-ng").IAgoraRTCClient | null>(null);
  const micRef = useRef<import("agora-rtc-sdk-ng").IMicrophoneAudioTrack | null>(null);
  const rtmRef = useRef<import("agora-rtm").RTMClient | null>(null);
  const finishing = useRef(false);

  const cleanupMedia = useCallback(async () => {
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

  const finalize = useCallback(
    async (turns: TranscriptTurn[]) => {
      if (finishing.current) return;
      finishing.current = true;
      setPhase("ending");
      try {
        await fetch(finalizePath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript_json: turns }),
        });
      } finally {
        await cleanupMedia();
        setPhase("thanks");
      }
    },
    [cleanupMedia, finalizePath],
  );

  const join = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const res = await fetch(startPath, { method: "POST" });
      const payload = (await res.json()) as StartPayload;
      if (!res.ok) {
        throw new Error(typeof payload.details === "string" ? payload.details : payload.error ?? `start failed (${res.status})`);
      }
      setJoined(true);

      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      try {
        (AgoraRTC as typeof AgoraRTC & { setParameter?: (k: string, v: unknown) => void }).setParameter?.("ENABLE_AUDIO_PTS", true);
      } catch {
        /* optional */
      }

      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      rtcRef.current = client;
      client.on("user-published", async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") user.audioTrack?.play();
        if (String(user.uid) === payload.agent_uid) setAgentConnected(true);
      });
      client.on("user-unpublished", (user) => {
        if (String(user.uid) === payload.agent_uid) setAgentConnected(false);
      });
      client.on("user-joined", (user) => {
        if (String(user.uid) === payload.agent_uid) setAgentConnected(true);
      });

      const mic = await AgoraRTC.createMicrophoneAudioTrack();
      micRef.current = mic;
      await client.join(payload.app_id || appId, payload.channel, payload.token, Number(payload.uid));
      await client.publish([mic]);

      const AgoraRTM = (await import("agora-rtm")).default;
      const rtm = new AgoraRTM.RTM(payload.app_id || appId, payload.uid);
      rtmRef.current = rtm;
      rtm.addEventListener("message", (event) => {
        const parsed = parseRtmMessage(event.message);
        if (parsed.kind === "state") setAgentState(parsed.state);
        if (parsed.kind === "error") setError(parsed.message);
        if (parsed.kind === "transcript") {
          setTranscript((prev) => {
            const next = upsertTranscript(prev, parsed.turn, parsed.inProgress);
            if (!parsed.inProgress && parsed.turn.role === "assistant") {
              const answers = extractAnswersFromTranscript(next, requiredFields);
              if (answers?.source === "agent_json") {
                queueMicrotask(() => void finalize(next));
              }
            }
            return next;
          });
        }
      });
      await rtm.login({ token: payload.token });
      await rtm.subscribe(payload.channel);

      setPhase("live");
    } catch (err) {
      await cleanupMedia();
      setPhase("idle");
      finishing.current = false;
      setError(err instanceof Error ? err.message : "failed to join");
    }
  }, [appId, cleanupMedia, finalize, requiredFields, startPath]);

  useEffect(() => {
    return () => {
      void cleanupMedia();
    };
  }, [cleanupMedia]);

  async function toggleMic() {
    const next = !micOn;
    try {
      await micRef.current?.setEnabled(next);
      setMicOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "mic toggle failed");
    }
  }

  if (phase === "thanks") {
    return (
      <section className="certificate text-center">
        <p className="eyebrow !mb-2 !text-ink">done</p>
        <h2 className="font-sans text-2xl font-semibold tracking-tight">Thanks — you can close this tab</h2>
        <p className="font-sans text-sm text-ink/70 mt-2">Your answers were saved.</p>
      </section>
    );
  }

  const status = statusLabel(phase, agentState, agentConnected);

  return (
    <section className="border border-ink bg-panel p-6 flex flex-col gap-5 items-center text-center">
      <p className={`eyebrow !mb-0 ${status === "listening" || status === "speaking" ? "text-teal" : ""}`}>
        {status}
      </p>
      <p className="text-sm text-[#53605a] max-w-sm">Allow the microphone. The agent asks one question at a time.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {phase === "idle" && (
          <button type="button" onClick={() => void join()} className="btn-ink">
            <span>Start</span>
            <strong>→</strong>
          </button>
        )}
        {phase === "connecting" && <span className="mono text-xs text-muted">joining…</span>}
        {phase === "live" && (
          <>
            <button type="button" onClick={() => void toggleMic()} className="btn-ghost">
              {micOn ? "Mute" : "Unmute"}
            </button>
            <button type="button" disabled={!joined} onClick={() => void finalize(transcript)} className="btn-ink">
              <span>Finish</span>
              <strong>→</strong>
            </button>
          </>
        )}
        {phase === "ending" && <span className="mono text-xs text-muted">saving…</span>}
      </div>
    </section>
  );
}
