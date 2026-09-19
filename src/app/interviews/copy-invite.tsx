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
      <button type="button" onClick={() => void copy()} className="btn-ghost">
        {copied ? "Copied" : "Copy link"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="mono text-xs bg-[#d8dfd8] border border-line px-2 py-1.5">{path}</code>
      <button type="button" onClick={() => void copy()} className="btn-ink">
        <span>{copied ? "Copied" : "Copy interviewee link"}</span>
        <strong>→</strong>
      </button>
      <a href={path} className="btn-ghost">
        Open
      </a>
    </div>
  );
}
