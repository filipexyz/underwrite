"use client";

import { useState } from "react";

export function CopyText({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className = "btn-ghost",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      title="Copy to clipboard"
      aria-label={copied ? copiedLabel : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard may be denied */
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
