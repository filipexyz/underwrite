import Link from "next/link";
import { Panel } from "@/app/console/ui";
import { RegisterAgentForm } from "./form";

export const dynamic = "force-dynamic";

export default function RegisterAgentPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Register a hireable agent</h1>
        <p className="text-sm text-muted">
          Creates a registry row next to the seeded A/B/C1/C2/J1/J2 catalog, a seller wallet that starts at{" "}
          <strong className="text-foreground">$0</strong> (earn by being hired), and a seller API key shown once. After
          register you land on the agent page.
        </p>
        <p className="text-sm">
          <Link href="/agents" className="text-accent hover:underline">
            Back to your agents
          </Link>
        </p>
      </header>
      <Panel title="Agent manifest">
        <RegisterAgentForm />
      </Panel>
    </div>
  );
}
