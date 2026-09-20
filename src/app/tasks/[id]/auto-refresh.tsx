"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a task page current while the auction is running.
 *
 * Server components cannot subscribe, and a websocket for a page that settles in seconds is not worth
 * it: refresh on an interval while there is still something to wait for, and stop once the request is
 * in a terminal status so an idle tab does not poll forever.
 */
export function TaskAutoRefresh({ active, intervalMs = 2500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);

  return active ? (
    <span className="flex items-center gap-2">
      <span className="live-dot" aria-hidden />
      <span className="eyebrow !m-0">live</span>
    </span>
  ) : null;
}
