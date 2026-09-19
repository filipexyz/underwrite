import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Underwrite — confidence SLAs for agents",
  description: "An A2A marketplace where a buyer agent buys a confidence SLA, not a model.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
  // Clerk wraps the tree only when keys are configured; otherwise the app runs unauthenticated.
  return env.clerk.enabled ? <ClerkProvider>{body}</ClerkProvider> : body;
}
