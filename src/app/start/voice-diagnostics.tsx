"use client";

import { useCallback, useEffect, useState } from "react";

type Step = { name: string; ok: boolean; detail: string; status?: number; body?: unknown };

type Diagnostics = {
  config: Record<string, unknown>;
  steps: Step[];
  tools?: string[];
  verdict: string;
  error?: string;
};

/**
 * Self-test for the voice path, on screen.
 *
 * Asked for directly: *"eu podia conseguir ver na tela se ele tá funcionando, se ele tá conseguindo conectar
 * com o MCP."* Every failure tonight was silent — a doubled `/api/v1` in the tool URL, a wallet with no
 * credit surfacing as an opaque provider error, an agent that never joined while the API reported success.
 * This calls our own MCP server the way Agora does and prints what came back, so the answer is visible
 * before a call rather than inferred after one.
 */
export function VoiceDiagnostics() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/voice/diagnostics", { cache: "no-store" });
      setData((await res.json()) as Diagnostics);
    } catch (error) {
      setData({
        config: {},
        steps: [],
        verdict: "failed to run diagnostics",
        error: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const ok = Boolean(data?.verdict?.startsWith("ok:"));

  return (
    <section className="border border-line bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className={`live-dot ${ok ? "" : "opacity-40"}`} aria-hidden />
          <span className="eyebrow !m-0">voice diagnostics</span>
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="font-mono text-[10px] tracking-wider uppercase text-teal hover:underline disabled:opacity-40"
        >
          {busy ? "running…" : "re-run"}
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        <p className={`font-mono text-[11px] leading-relaxed ${ok ? "text-teal" : "text-danger"}`}>
          {data?.verdict ?? "…"}
        </p>

        {data?.steps?.length ? (
          <ul className="flex flex-col gap-1">
            {data.steps.map((step) => (
              <li key={step.name} className="font-mono text-[10px] leading-relaxed">
                <span className={step.ok ? "text-teal" : "text-danger"}>{step.ok ? "✓" : "✗"}</span>{" "}
                <span className="text-ink">{step.name}</span>
                <span className="text-muted">
                  {" "}
                  {step.status ?? ""} {step.detail}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {data?.config ? (
          <details>
            <summary className="cursor-pointer eyebrow !mb-0">configuration</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#53605a]">
              {JSON.stringify(data.config, null, 2)}
            </pre>
          </details>
        ) : null}

        <details>
          <summary className="cursor-pointer eyebrow !mb-0">raw responses</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#53605a]">
            {JSON.stringify(data?.steps?.map((s) => ({ [s.name]: s.body })) ?? [], null, 2)}
          </pre>
        </details>
      </div>
    </section>
  );
}
