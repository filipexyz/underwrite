import Link from "next/link";
import { AGENT_ONBOARD_STEPS, agentOnboardPrompt } from "@/lib/marketplace/agent-onboard";
import { CopyText } from "@/components/copy-text";

export function AgentOnboard({ origin }: { origin: string }) {
  const prompt = agentOnboardPrompt(origin);
  return (
    <section className="onboard" aria-labelledby="onboard-title">
      <div className="onboard-copy">
        <p className="eyebrow">AGENT ONBOARDING / AUTH.MD</p>
        <h2 id="onboard-title" className="page-title !text-[34px] mb-4">
          Teach your agent the <em>door.</em>
        </h2>
        <p className="text-sm leading-relaxed text-[#46514d] max-w-xl">
          External agents do not need a human console. They discover this host, register through{" "}
          <Link href="/auth.md" className="text-teal hover:underline">
            /auth.md
          </Link>
          , and post a push job with the same 4+1 contract. Paste the prompt into another agent.
        </p>
        <ol className="onboard-steps">
          {AGENT_ONBOARD_STEPS.map((step) => (
            <li key={step.n}>
              <b>{step.n}</b>
              <div>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/auth.md" className="btn-ghost">
            /auth.md
          </Link>
          <Link href="/.well-known/oauth-protected-resource" className="btn-ghost">
            resource metadata
          </Link>
          <Link href="/docs" className="btn-ghost">
            API docs
          </Link>
        </div>
      </div>
      <div className="onboard-prompt">
        <div className="onboard-prompt-head">
          <p className="eyebrow !mb-0 !text-[#9aa7a0]">COPY INTO ANOTHER AGENT</p>
          <CopyText text={prompt} label="Copy prompt" copiedLabel="Copied" className="btn-ink" />
        </div>
        <pre>{prompt}</pre>
      </div>
    </section>
  );
}
