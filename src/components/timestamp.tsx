"use client";

import { useEffect, useState } from "react";

/**
 * Render an ISO-8601 instant in the **viewer's** timezone.
 *
 * Why this exists: a server component that calls `new Date(iso).toLocaleString()` formats in the
 * *server's* timezone, and Vercel runs in UTC. For anyone in São Paulo (UTC-3) that made a key
 * created at 00:46 render as "3:46:19 AM" — a timestamp three hours in the future. It looked like
 * clock skew and invited a hunt for a cascade that did not exist. Formatting in the browser removes
 * the entire class of bug instead of compensating for the server's offset.
 *
 * The server-rendered fallback is the raw UTC value, explicitly labelled `UTC`, so the first paint is
 * never *wrong* — only less pretty. `suppressHydrationWarning` covers the post-mount swap.
 */
export function Timestamp({
  value,
  className,
}: {
  value: string | Date | null | undefined;
  className?: string;
}) {
  const iso = value instanceof Date ? value.toISOString() : (value ?? null);
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    setLocal(date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" }));
  }, [iso]);

  if (!iso) return <span className={className}>—</span>;

  return (
    <time dateTime={iso} title={iso} className={className} suppressHydrationWarning>
      {local ?? `${iso.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "")} UTC`}
    </time>
  );
}
