import type { Metadata } from "next";
import { PageIntro } from "@/app/console/ui";
import { DevelopersTabs } from "../tabs";
import { Playground } from "./playground-client";

export const metadata: Metadata = {
  title: "Playground — Underwrite",
  description: "Fire a sample request or inspect a seller agent with a pasted API key.",
};

export default function DevelopersPlaygroundPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="SANDBOX / SESSION ONLY"
        title={
          <>
            Fire a <em>mandate.</em>
          </>
        }
        lede="Paste a key once. It lives in this tab’s sessionStorage — never localStorage, never the server. Clerk is not consulted; the key is the agent."
        action={<DevelopersTabs current="playground" />}
      />
      <Playground />
    </div>
  );
}
