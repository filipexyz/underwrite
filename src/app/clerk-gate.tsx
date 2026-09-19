import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { env } from "@/lib/env";

/** Clerk wraps signed-in human shells. `/i/[token]` stays outside this tree. */
export function ClerkGate({ children }: { children: ReactNode }) {
  if (!env.clerk.enabled) return children;
  return <ClerkProvider>{children}</ClerkProvider>;
}
