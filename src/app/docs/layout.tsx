import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { DocsTheme } from "./docs-theme";
import "./docs.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-docs-sans",
});

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsTheme className={inter.variable}>{children}</DocsTheme>;
}
