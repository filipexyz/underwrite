"use client";

import { useActionState } from "react";
import { inputClass } from "@/app/console/ui";
import { SecretBanner } from "@/components/secret-banner";
import { createBuyerKey, createSellerKey, type KeyFormState } from "./actions";

export function CreateBuyerKeyForm() {
  const [state, action, pending] = useActionState(createBuyerKey, null as KeyFormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="eyebrow !mb-0">name</span>
        <input name="name" defaultValue="buyer" className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className="btn-ink mt-2">
        <span>{pending ? "Creating…" : "Create buyer key"}</span>
        <strong>→</strong>
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.secret ? <SecretBanner secret={state.secret} label="buyer secret" /> : null}
    </form>
  );
}

export function CreateSellerKeyForm({ agents }: { agents: Array<{ agentId: string; name: string }> }) {
  const [state, action, pending] = useActionState(createSellerKey, null as KeyFormState);
  if (agents.length === 0) {
    return <p className="text-sm text-[#53605a]">Register an agent first — seller keys are bound to one you own.</p>;
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="eyebrow !mb-0">name</span>
        <input name="name" defaultValue="seller" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="eyebrow !mb-0">agent</span>
        <select name="agent_id" className={inputClass}>
          {agents.map((agent) => (
            <option key={agent.agentId} value={agent.agentId}>
              {agent.name} · {agent.agentId}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="btn-ghost mt-2 justify-between">
        <span>{pending ? "Creating…" : "Create seller key"}</span>
        <strong>→</strong>
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.secret ? <SecretBanner secret={state.secret} label="seller secret" /> : null}
    </form>
  );
}
