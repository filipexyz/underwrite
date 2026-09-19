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
  agora_agent_id?: string;
  error?: string;
  details?: unknown;
};

type Props = {
  needId: string;
  title: string;
  questions: string[];
  requiredFields: string[];
  appId: string;
};

export function InterviewRoom({ needId, title, questions, requiredFields, appId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "connecting" | "live" | "ending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentState, setAgentState] = useState("idle");
  const [micOn, setMicOn] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
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
    async (sid: string, turns: TranscriptTurn[]) => {
      setPhase("ending");
      try {
        await fetch(`/api/v1/interviews/sessions/${sid}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript_json: turns }),
        });
      } finally {
        await cleanupMedia();
        router.push(`/interviews/${needId}`);
        router.refresh();
      }
    },
    [cleanupMedia, needId, router],
  );

  const join = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const res = await fetch(`/api/v1/interviews/needs/${needId}/start`, { method: "POST" });
      const payload = (await res.json()) as StartPayload;
      if (!res.ok) {
        throw new Error(typeof payload.details === "string" ? payload.details : payload.error ?? `start failed (${res.status})`);
      }
      setSessionId(payload.session_id);

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
  }, [appId, cleanupMedia, needId]);

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
            The agent covers these questions one at a time. When it says it is done, end the call to store answers.
          </p>
          <ol className="list-decimal pl-5 text-muted">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          {error && <p className="text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {phase === "idle" && (
              <button type="button" onClick={() => void join()} className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90">
                Start conversation
              </button>
            )}
            {phase === "connecting" && (
              <span className="mono text-xs text-muted">minting token · starting GPT Live…</span>
            )}
            {phase === "live" && (
              <>
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background"
                >
                  {micOn ? "Mute mic" : "Unmute mic"}
                </button>
                <button
                  type="button"
                  disabled={!sessionId}
                  onClick={() => sessionId && void finalize(sessionId, transcript)}
                  className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  End and save answers
                </button>
              </>
            )}
            {phase === "ending" && <span className="mono text-xs text-muted">finalizing…</span>}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Transcript">
          {transcript.length === 0 ? (
            <p className="text-sm text-muted">
              {phase === "live"
                ? "Waiting for RTM turns. GPT Live preview may omit user ASR — agent lines still land here."
                : "Start the conversation to see live turns."}
            </p>
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
            <p className="text-sm text-muted">
              The agent&apos;s final JSON (or a post-call extract) is stored on finalize. Required:{" "}
              <span className="mono text-xs">{requiredFields.join(", ")}</span>
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
