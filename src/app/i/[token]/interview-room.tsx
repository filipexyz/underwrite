"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { answersCoverRequiredFields, extractAnswersFromTranscript } from "@/lib/interviews/extract";
import { parseRtmMessage, upsertTranscript } from "@/lib/interviews/rtm";
import type { TranscriptTurn } from "@/lib/interviews/types";
import { CallSurface, type CallPhase } from "./call-surface";

type StartPayload = {
  channel: string;
  token: string;
  uid: string;
  agent_uid: string;
  app_id: string;
  error?: string;
  details?: unknown;
};

type RoomPhase = CallPhase | "thanks";

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
  const [phase, setPhase] = useState<RoomPhase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [agentState, setAgentState] = useState("idle");
  const [micOn, setMicOn] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [agentConnected, setAgentConnected] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const rtcRef = useRef<import("agora-rtc-sdk-ng").IAgoraRTCClient | null>(null);
  const micRef = useRef<import("agora-rtc-sdk-ng").IMicrophoneAudioTrack | null>(null);
  const rtmRef = useRef<import("agora-rtm").RTMClient | null>(null);
  const finishing = useRef(false);
  const joining = useRef(false);
  const liveSince = useRef<number | null>(null);

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
        const res = await fetch(finalizePath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript_json: turns }),
        });
        if (!res.ok) {
          finishing.current = false;
          setPhase("live");
          if (res.status !== 409 && res.status !== 422) {
            const payload = (await res.json().catch(() => null)) as { error?: string } | null;
            setError(payload?.error ?? `could not save answers (${res.status})`);
          }
          return;
        }
        await cleanupMedia();
        setPhase("thanks");
      } catch (err) {
        finishing.current = false;
        setPhase("live");
        setError(err instanceof Error ? err.message : "could not save answers");
      }
    },
    [cleanupMedia, finalizePath],
  );

  const join = useCallback(async () => {
    if (joining.current || finishing.current) return;
    joining.current = true;
    setError(null);
    setPhase("connecting");
    setAgentConnected(false);
    setAgentState("idle");
    setElapsedSeconds(0);
    liveSince.current = null;
    try {
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      try {
        (AgoraRTC as typeof AgoraRTC & { setParameter?: (k: string, v: unknown) => void }).setParameter?.("ENABLE_AUDIO_PTS", true);
      } catch {
        /* optional */
      }

      const mic = await AgoraRTC.createMicrophoneAudioTrack();
      micRef.current = mic;

      const res = await fetch(startPath, { method: "POST" });
      const payload = (await res.json()) as StartPayload;
      if (!res.ok) {
        throw new Error(typeof payload.details === "string" ? payload.details : payload.error ?? `start failed (${res.status})`);
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
              if (answersCoverRequiredFields(answers, requiredFields)) {
                queueMicrotask(() => void finalize(next));
              }
            }
            return next;
          });
        }
      });
      await rtm.login({ token: payload.token });
      await rtm.subscribe(payload.channel);

      liveSince.current = Date.now();
      setPhase("live");
    } catch (err) {
      await cleanupMedia();
      joining.current = false;
      finishing.current = false;
      setPhase("error");
      setError(err instanceof Error ? err.message : "failed to join");
    }
  }, [appId, cleanupMedia, finalize, requiredFields, startPath]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void join();
    });
    return () => {
      cancelled = true;
      void cleanupMedia();
    };
    // Auto-join once on mount. `join` closes over stable room props.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only auto-start
  }, [cleanupMedia]);

  useEffect(() => {
    if (phase !== "live") return;
    const startedAt = liveSince.current ?? Date.now();
    liveSince.current = startedAt;
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

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
        <p className="eyebrow !mb-2 !text-ink">call ended</p>
        <h2 className="font-sans text-2xl font-semibold tracking-tight">Thanks — you can close this tab</h2>
        <p className="font-sans text-sm text-ink/70 mt-2">The interviewer saved your answers.</p>
      </section>
    );
  }

  return (
    <CallSurface
      phase={phase}
      agentState={agentState}
      agentConnected={agentConnected}
      micOn={micOn}
      elapsedSeconds={elapsedSeconds}
      error={error}
      transcript={transcript}
      onToggleMic={() => void toggleMic()}
      onRejoin={() => {
        joining.current = false;
        void join();
      }}
    />
  );
}
