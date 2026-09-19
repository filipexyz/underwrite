"use client";

import { useState } from "react";

export function SecretBanner({ secret, label = "API secret" }: { secret: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 flex flex-col gap-2">
      <p className="text-xs uppercase tracking-wider text-muted">copy once · {label}</p>
      <p className="text-sm text-muted">This plaintext is not stored. Leave this page and it is gone.</p>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <code className="mono text-xs break-all rounded bg-background border border-border px-2 py-1.5 flex-1">{secret}</code>
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-accent text-background px-3 py-1.5 text-sm font-medium hover:opacity-90 shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
