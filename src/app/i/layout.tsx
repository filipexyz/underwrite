import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "Interview", template: "%s" },
  description: "Voice interview. You can close this tab when it is done.",
};

/** No console nav, no marketplace chrome, no Clerk. */
export default function PublicInterviewLayout({ children }: { children: ReactNode }) {
  return children;
}
