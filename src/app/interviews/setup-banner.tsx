import { env } from "@/lib/env";

export function SetupBanner() {
  if (env.agora.enabled) return null;
  return (
    <section className="outcome-withheld">
      <p className="eyebrow !mb-2 !text-ink">interview pool disabled</p>
      <p className="text-sm leading-relaxed">
        Voice keys are not set. You can still register needs;{" "}
        <code className="text-ink">POST /start</code> returns <span className="mono">503</span> until these environment
        variables are present:
      </p>
      <ul className="mono text-xs text-ink/70 mt-2 flex flex-col gap-1">
        {env.agora.missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p className="text-sm text-ink/70 mt-3">
        See README for the interview pool setup. The marketplace is unaffected.
      </p>
    </section>
  );
}
