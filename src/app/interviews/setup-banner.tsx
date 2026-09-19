import { env } from "@/lib/env";

export function SetupBanner() {
  if (env.agora.enabled) return null;
  return (
    <section className="rounded-lg border border-warn/40 bg-warn/5 p-4 flex flex-col gap-2 text-sm">
      <p className="text-xs uppercase tracking-wider text-muted">interview pool disabled</p>
      <p>
        Agora + GPT Live keys are not set. You can still register needs;{" "}
        <code className="text-foreground">POST /start</code> returns <span className="mono">503</span> until these are
        present:
      </p>
      <ul className="mono text-xs text-muted list-disc pl-5">
        {env.agora.missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p className="text-muted">
        See README <span className="text-foreground">Interview pool (Agora)</span>. GPT Live is an early-access preview
        (<span className="mono">{env.agora.model}</span>). The marketplace is unaffected.
      </p>
    </section>
  );
}
