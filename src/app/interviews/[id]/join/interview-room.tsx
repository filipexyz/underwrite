"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Panel } from "@/app/console/ui";
import { extractAnswersFromTranscript } from "@/lib/interviews/extract";
import { parseRtmMessage, upsertTranscript } from "@/lib/interviews/rtm";
import type { TranscriptTurn } from "@/lib/interviews/types";

type StartPayload = {
  session_id: string;
  channel: string;
  token: string;
  uid: string;
  agent_uid: string;
  app_id: string;
  error?: string;
  details?: unknown;
};

type Props = {
  title: string;
  startPath: string;
  finalizePath: string;
  appId: string;
  requiredFields: string[];
  variant: "public" | "creator";
  creatorNeedId?: string;
};

export function InterviewRoom({ title, startPath, finalizePath, appId, requiredFields, variant, creatorNeedId }: Props) {
  const router = useRouter();
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
  const preview = useMemo(() => extractAnswersFromTranscript(transcript, requiredFields), [transcript, requiredFields]);

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
      setPhase("ending");
      try {
        await fetch(finalizePath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript_json: turns }),
        });
      } finally {
        await cleanupMedia();
        if (variant === "creator" && creatorNeedId) {
          router.push(`/interviews/${creatorNeedId}`);
          router.refresh();
        } else {
          setPhase("thanks");
        }
      }
    },
    [cleanupMedia, creatorNeedId, finalizePath, router, variant],
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
          setTranscript((prev) => upsertTranscript(prev, parsed.turn, parsed.inProgress));
        }
      });
      await rtm.login({ token: payload.token });
      await rtm.subscribe(payload.channel);

      setPhase("live");
    } catch (err) {
      await cleanupMedia();
      setPhase("idle");
      setError(err instanceof Error ? err.message : "failed to join");
    }
  }, [appId, cleanupMedia, startPath]);

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
      <section className="rounded-lg border border-border bg-panel p-8 flex flex-col gap-3 text-center">
        <p className="text-xs uppercase tracking-wider text-accent">done</p>
        <h2 className="text-2xl font-semibold tracking-tight">Thanks — you can close this tab</h2>
        <p className="text-sm text-muted">Your answers were saved. Nothing else to do here.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={title}
        aside={
          <div className="flex items-center gap-2">
            <Badge value={phase} />
            <Badge value={agentState} />
            {agentConnected ? <Badge value="agent" /> : null}
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">
            {variant === "public"
              ? "Allow the microphone. A voice agent will ask a few questions, one at a time. Hit Finish when it says it's done."
              : "Preview the interviewee call. Prefer sending the public /i/ link."}
          </p>
          {error && <p className="text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {phase === "idle" && (
              <button type="button" onClick={() => void join()} className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90">
                Start
              </button>
            )}
            {phase === "connecting" && <span className="mono text-xs text-muted">connecting…</span>}
            {phase === "live" && (
              <>
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background"
                >
                  {micOn ? "Mute" : "Unmute"}
                </button>
                <button
                  type="button"
                  disabled={!joined}
                  onClick={() => void finalize(transcript)}
                  className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  Finish
                </button>
              </>
            )}
            {phase === "ending" && <span className="mono text-xs text-muted">saving…</span>}
          </div>
        </div>
      </Panel>

      {variant === "creator" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Transcript">
            {transcript.length === 0 ? (
              <p className="text-sm text-muted">Live turns appear here after Start.</p>
            ) : (
              <ul className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                {transcript.map((turn, index) => (
                  <li key={`${turn.turn_id ?? index}-${turn.role}-${index}`} className="text-sm">
                    <span className="mono text-xs text-muted">{turn.role}</span>
                    <p>{turn.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Parsed answers">
            {preview ? (
              <pre className="text-xs leading-relaxed overflow-x-auto rounded bg-background p-3 border border-border">
                {JSON.stringify(preview, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted">Waiting for the agent&apos;s final JSON.</p>
            )}
          </Panel>
        </div>
      ) : phase === "live" && transcript.length > 0 ? (
        <Panel title="Live">
          <ul className="flex flex-col gap-2 max-h-56 overflow-y-auto">
            {transcript.slice(-6).map((turn, index) => (
              <li key={`${turn.turn_id ?? index}-${index}`} className="text-sm text-muted">
                {turn.role === "assistant" ? turn.text : "You spoke"}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
