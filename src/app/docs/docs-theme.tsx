"use client";

import { useEffect, type ReactNode } from "react";

/** Isolates the dark docs chrome from the paper-themed root layout. */
export function DocsTheme({ children, className }: { children: ReactNode; className?: string }) {
  useEffect(() => {
    document.documentElement.dataset.uwDocs = "";
    return () => {
      delete document.documentElement.dataset.uwDocs;
    };
  }, []);

  return <div className={["uw-docs", className].filter(Boolean).join(" ")}>{children}</div>;
}
