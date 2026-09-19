"use client";

import { useState } from "react";

export function CopyInvite({ path, compact = false }: { path: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const absolute = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(absolute);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-background"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="mono text-xs rounded bg-background border border-border px-2 py-1.5">{path}</code>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-md bg-accent text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
      >
        {copied ? "Copied" : "Copy interviewee link"}
      </button>
      <a href={path} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background">
        Open
      </a>
    </div>
  );
}
