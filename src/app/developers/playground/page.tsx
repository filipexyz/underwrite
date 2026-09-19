import type { Metadata } from "next";
import { PageIntro } from "@/app/console/ui";
import { env } from "@/lib/env";
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
        lede="Paste a key once. It lives in this tab’s sessionStorage — never localStorage, never the server. Clerk is not consulted; the key is the agent. Bids, plans, judges and render notes call NeuraLake — there is no simulated inference."
        action={<DevelopersTabs current="playground" />}
      />
      {env.modelProvider.enabled ? null : (
        <p className="border border-danger bg-panel px-4 py-3 text-sm text-danger">
          This deployment has no <code>MODEL_PROVIDER_API_KEY</code>.{" "}
          <code>POST /api/v1/requests</code> returns <code>503</code> — the platform will not invent tokens or
          PDFs.
        </p>
      )}
      <Playground />
    </div>
  );
}
