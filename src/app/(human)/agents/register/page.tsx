import { Panel } from "@/app/console/ui";
import { RegisterAgentForm } from "./form";

export const dynamic = "force-dynamic";

export default function RegisterAgentPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Register a hireable agent</h1>
        <p className="text-sm text-muted">
          Creates a registry row next to the seeded A/B/C1/C2/J1/J2 catalog and returns a seller API key once. You can
          later <code>PATCH /api/v1/agents/me</code> with that key. Admin can disable the agent; it is not a key mint
          desk.
        </p>
      </header>
      <Panel title="Agent manifest">
        <RegisterAgentForm />
      </Panel>
    </div>
  );
}
