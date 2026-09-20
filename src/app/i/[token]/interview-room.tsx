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
  transcriptPath,
  appId,
  requiredFields,
}: {
  startPath: string;
  finalizePath: string;
  /** Live transcript append. Optional so the room still runs if it is not wired. */
  transcriptPath?: string;
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
  /** Turns already pushed to the server, so the creator's view can follow along live. */
  const pushedRef = useRef(0);
  const transcriptRef = useRef<TranscriptTurn[]>([]);

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

  const finalize = useCallback(    async (turns: TranscriptTurn[]) => {
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
          /*
           * 409 means the brief was incomplete — the server tells us exactly which fields are missing.
           * This used to be swallowed silently (no error, phase back to `live`), so the call simply
           * appeared to freeze with the human unable to tell whether anything had happened.
           */
          const payload = (await res.json().catch(() => null)) as
            | { error?: string; details?: { missing?: string[] } }
            | null;
          const missing = payload?.details?.missing;
          setError(
            missing && missing.length > 0
              ? `The interviewer hasn't captured: ${missing.join(", ")}. Keep talking — say those again and it will close the call.`
              : (payload?.error ?? `could not save answers (${res.status})`),
          );
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

  // Keep the latest transcript in a ref so the push loop below can stay keyed on `phase` alone.
  // Depending on `transcript` directly would tear down and rebuild the interval on every turn.
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  /**
   * Publish settled turns while the call is live, so the creator can watch the interview happen
   * instead of only seeing it after finalize. Best-effort by design: the authoritative write is still
   * the transcript in the finalize payload, so a failed push loses nothing but the live view.
   */
  useEffect(() => {
    if (!transcriptPath || phase !== "live") return;
    const timer = window.setInterval(() => {
      // Skip the trailing in-progress turn (turn_id -1): it is still growing and would land as a
      // separate row from the version we push next tick.
      const settled = transcriptRef.current.filter((turn) => turn.turn_id !== -1);
      const from = pushedRef.current;
      if (settled.length <= from) return;
      const pending = settled.slice(from).slice(-60);
      pushedRef.current = settled.length;
      void fetch(transcriptPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript_json: pending }),
      })
        .then((res) => {
          // 410/409 mean the session already finished; stop trying rather than hammering it.
          if (!res.ok && (res.status === 409 || res.status === 410)) pushedRef.current = settled.length;
          else if (!res.ok) pushedRef.current = from;
        })
        .catch(() => {
          // Retry from where we were. Re-sends merge by `turn_id` server-side, so this is safe.
          pushedRef.current = from;
        });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [phase, transcriptPath]);

  const join = useCallback(async () => {    if (joining.current || finishing.current) return;
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
