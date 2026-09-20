"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscriptTurn } from "@/lib/interviews/types";

type Payload = {
  status?: string;
  total?: number;
  from?: number;
  turns?: TranscriptTurn[];
  error?: string;
};

/**
 * The creator's live view of a call in progress.
 *
 * Turns reach the database only through the interviewee's room pushing them
 * (`/api/v1/interviews/i/[token]/transcript`); before that existed, a creator could see nothing until
 * the call ended. Polls with an `after` cursor so each tick transfers only new turns, and stops once
 * the session is no longer live — a finished interview is frozen, so there is nothing left to wait for.
 */
export function LiveTranscript({
  sessionId,
  initialTurns,
  initialStatus,
}: {
  sessionId: string;
  initialTurns: TranscriptTurn[];
  initialStatus: string;
}) {
  const [turns, setTurns] = useState<TranscriptTurn[]>(initialTurns);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(initialTurns.length);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (status !== "live") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/interviews/sessions/${sessionId}/transcript?after=${cursor.current}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as Payload | null;
          setError(body?.error ?? `could not load transcript (${res.status})`);
          return;
        }
        const body = (await res.json()) as Payload;
        setError(null);
        // The server reports the absolute index its slice starts at, so a rolling window that has
        // dropped old turns cannot desynchronise the cursor.
        const from = typeof body.from === "number" ? body.from : cursor.current;
        if (body.turns?.length) {
          setTurns((prev) => {
            const next = from >= prev.length ? [...prev, ...body.turns!] : [...prev.slice(0, from), ...body.turns!];
            return next;
          });
        }
        if (typeof body.total === "number") cursor.current = body.total;
        if (body.status) setStatus(body.status);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "transcript poll failed");
      }
    };

    const timer = window.setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId, status]);

  // Follow the tail, but only while the reader is already at the bottom.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }, [turns]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={status === "live" ? "live-dot" : "live-dot opacity-40"} aria-hidden />
        <span className="eyebrow !m-0">{status === "live" ? "live" : status}</span>
        <span className="mono text-[10px] text-muted">{turns.length} turns</span>
      </div>

      {error ? <p className="mono text-xs text-danger">{error}</p> : null}

      <div ref={boxRef} className="max-h-[420px] overflow-y-auto flex flex-col gap-2 pr-1">
        {turns.length === 0 ? (
          <Empty>
            {status === "live"
              ? "Waiting for the first turn. The transcript appears here as the interviewer speaks."
              : "No transcript stored for this session."}
          </Empty>
        ) : (
          turns.map((turn, i) => (
            <div key={`${turn.turn_id ?? "x"}-${i}`} className="flex flex-col gap-0.5">
              <span className="mono text-[10px] uppercase tracking-wider text-muted">
                {turn.role === "user" ? "interviewee" : turn.role}
              </span>
              <p className="text-sm leading-relaxed text-ink/90">{turn.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mono text-xs text-muted leading-relaxed">{children}</p>;
}
