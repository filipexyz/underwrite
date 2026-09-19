import type { TranscriptTurn } from "@/lib/interviews/types";

export type CallPhase = "connecting" | "live" | "ending" | "error";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function agentHeadline(phase: CallPhase, agentState: string, agentConnected: boolean): string {
  if (phase === "connecting") return "Connecting";
  if (phase === "ending") return "Ending the call";
  if (phase === "error") return "Couldn't connect";
  if (!agentConnected) return "Waiting for interviewer";
  const state = agentState.toLowerCase();
  if (state === "speaking") return "Interviewer is speaking";
  if (state === "thinking") return "Interviewer is thinking";
  return "Interviewer is listening";
}

function avatarMotion(phase: CallPhase, agentState: string, agentConnected: boolean): string {
  if (phase === "connecting") return "interview-avatar-connecting";
  if (phase === "live" && agentConnected && agentState.toLowerCase() === "speaking") return "interview-avatar-speaking";
  if (phase === "live" && agentConnected && agentState.toLowerCase() === "thinking") return "interview-avatar-thinking";
  if (phase === "live") return "interview-avatar-listening";
  return "";
}

export function CallSurface({
  phase,
  agentState,
  agentConnected,
  micOn,
  elapsedSeconds,
  error,
  transcript,
  onToggleMic,
  onRejoin,
}: {
  phase: CallPhase;
  agentState: string;
  agentConnected: boolean;
  micOn: boolean;
  elapsedSeconds: number;
  error: string | null;
  transcript: TranscriptTurn[];
  onToggleMic: () => void;
  onRejoin: () => void;
}) {
  const live = phase === "live";
  const headline = agentHeadline(phase, agentState, agentConnected);
  const connectedLabel = live && agentConnected ? "Connected to interviewer" : live ? "Joining interviewer…" : phase === "connecting" ? "Setting up the call" : "";

  return (
    <section className="interview-call border border-ink bg-panel overflow-hidden flex flex-col min-h-[32rem]">
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-ink">
        <div className="flex items-center gap-2 min-w-0">
          {live ? (
            <span className="live-link !py-1">
              <span className="live-dot interview-live-dot" aria-hidden />
              <span className="live-copy">Live</span>
            </span>
          ) : phase === "connecting" ? (
            <span className="live-link !py-1 !border-[#d6823e]">
              <span className="live-dot interview-live-dot !bg-orange" aria-hidden />
              <span className="live-copy">Connecting</span>
            </span>
          ) : phase === "ending" ? (
            <span className="eyebrow !mb-0">Ending</span>
          ) : (
            <span className="eyebrow !mb-0 text-danger">Offline</span>
          )}
        </div>
        <p className="mono text-sm tabular-nums">{live || phase === "ending" ? formatElapsed(elapsedSeconds) : "00:00"}</p>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <div className="relative size-36 grid place-items-center">
          {(live || phase === "connecting") && (
            <>
              <span className="interview-ring absolute inset-0 rounded-full border border-teal/50" />
              <span className="interview-ring interview-ring-delay absolute inset-[-10px] rounded-full border border-teal/30" />
            </>
          )}
          <div
            className={`relative size-28 rounded-full grid place-items-center border ${
              live && agentConnected ? "bg-acid border-ink" : "bg-paper border-ink"
            } ${avatarMotion(phase, agentState, agentConnected)}`}
          >
            <span className="font-mono text-sm font-semibold tracking-wider uppercase">AI</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 max-w-sm">
          <p className="font-sans text-2xl font-semibold tracking-tight" aria-live="polite">
            {headline}
          </p>
          {connectedLabel ? <p className="font-sans text-sm text-teal">{connectedLabel}</p> : null}
          <p className="font-sans text-sm text-[#53605a]">The interviewer will end the call when everything is answered.</p>
        </div>

        {error && <p className="font-sans text-sm text-danger max-w-sm">{error}</p>}
      </div>

      <div className="flex flex-col items-center gap-4 px-6 pb-6">
        {phase === "error" ? (
          <button type="button" onClick={onRejoin} className="btn-ink">
            <span>Rejoin call</span>
            <strong>→</strong>
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleMic}
            disabled={phase !== "live"}
            aria-pressed={!micOn}
            className={`size-16 rounded-full border border-ink font-mono text-[10px] uppercase tracking-wider disabled:opacity-40 ${
              micOn ? "bg-paper text-ink hover:bg-acid" : "bg-[#ffccb1] text-danger"
            }`}
          >
            {micOn ? "Mute" : "Unmute"}
          </button>
        )}

        {transcript.length > 0 && (
          <details className="w-full border border-line bg-paper text-left">
            <summary className="cursor-pointer px-3 py-2 eyebrow !mb-0">Transcript</summary>
            <ol className="px-3 pb-3 flex flex-col gap-2 max-h-40 overflow-y-auto">
              {transcript.map((turn, i) => (
                <li key={`${turn.turn_id ?? i}-${turn.role}`} className="text-xs leading-relaxed">
                  <span className="mono text-muted">{turn.role === "assistant" ? "Interviewer" : "You"} · </span>
                  <span>{turn.text}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </section>
  );
}
