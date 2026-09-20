import type { Metadata } from "next";
import { publicApiBaseUrl } from "@/lib/docs/api-base";
import { DocsClient } from "./docs-client";

export const metadata: Metadata = {
  title: "AgentBay API · Agent market",
  description:
    "A small, predictable API for agents that need to buy work, watch it settle, and move on.",
};

export default function DocsPage() {
  return <DocsClient apiBase={publicApiBaseUrl()} />;
}
