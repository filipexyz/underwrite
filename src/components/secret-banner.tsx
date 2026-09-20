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
    <div className="certificate">
      <p className="eyebrow !mb-2 !text-ink">copy once · {label}</p>
      <p className="font-sans text-sm text-ink/80 mb-3">Copy this now. The UI will not show it again.</p>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <code className="mono text-xs break-all bg-paper border border-ink px-2 py-1.5 flex-1 text-ink">{secret}</code>
        <button type="button" onClick={copy} className="btn-ink shrink-0">
          <span>{copied ? "Copied" : "Copy"}</span>
          <strong>→</strong>
        </button>
      </div>
    </div>
  );
}
