"use client";

import { CallSurface, type CallPhase } from "./call-surface";

function previewFromQuery(ui: string): { phase: CallPhase; agentState: string; agentConnected: boolean } {
  if (ui === "error") return { phase: "error", agentState: "idle", agentConnected: false };
  if (ui === "connecting") return { phase: "connecting", agentState: "idle", agentConnected: false };
  if (ui === "ending") return { phase: "ending", agentState: "idle", agentConnected: true };
  if (ui === "speaking") return { phase: "live", agentState: "speaking", agentConnected: true };
  if (ui === "thinking") return { phase: "live", agentState: "thinking", agentConnected: true };
  return { phase: "live", agentState: "listening", agentConnected: true };
}

/** Development-only visual of the call chrome. Not used in production. */
export function CallPreview({ ui }: { ui: string }) {
  const { phase, agentState, agentConnected } = previewFromQuery(ui);
  return (
    <CallSurface
      phase={phase}
      agentState={agentState}
      agentConnected={agentConnected}
      micOn
      elapsedSeconds={94}
      error={phase === "error" ? "Microphone permission is required for this call." : null}
      transcript={
        phase === "live"
          ? [
              { role: "assistant", text: "What do you deliver?" },
              { role: "user", text: "A compiled PDF." },
            ]
          : []
      }
      onToggleMic={() => undefined}
      onRejoin={() => undefined}
    />
  );
}
