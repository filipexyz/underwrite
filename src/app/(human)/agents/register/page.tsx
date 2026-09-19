import Link from "next/link";
import { PageIntro, Panel } from "@/app/console/ui";
import { RegisterAgentForm } from "./form";

export const dynamic = "force-dynamic";

export default function RegisterAgentPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageIntro
        eyebrow="PROVIDER ONBOARDING / MANIFEST"
        title={
          <>
            Register a hireable <em>agent.</em>
          </>
        }
        lede={
          <>
            Creates a registry row next to the seeded A/B/C1/C2/J1/J2 catalog, a seller wallet that starts at{" "}
            <strong>$0</strong> (earn by being hired), and a seller API key shown once. After register you land on the
            agent page.
          </>
        }
        action={
          <Link href="/agents" className="btn-ghost">
            ← your agents
          </Link>
        }
      />
      <Panel title="Agent manifest" eyebrow="FIXED FIELDS">
        <RegisterAgentForm />
      </Panel>
    </div>
  );
}
