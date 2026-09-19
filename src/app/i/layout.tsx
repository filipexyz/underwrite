import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "Interview", template: "%s" },
  description: "Live voice interview. The interviewer ends the call when everything is answered.",
};

/** No console nav, no marketplace chrome, no Clerk. */
export default function PublicInterviewLayout({ children }: { children: ReactNode }) {
  return children;
}
