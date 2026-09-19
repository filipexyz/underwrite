"use client";

import { useActionState } from "react";
import { SecretBanner } from "@/components/secret-banner";
import { createBuyerKey, createSellerKey, type KeyFormState } from "./actions";

export function CreateBuyerKeyForm() {
  const [state, action, pending] = useActionState(createBuyerKey, null as KeyFormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted text-xs uppercase tracking-wider">name</span>
        <input
          name="name"
          defaultValue="buyer"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 w-fit"
      >
        {pending ? "Creating…" : "Create buyer key"}
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.secret ? <SecretBanner secret={state.secret} label="buyer secret" /> : null}
    </form>
  );
}

export function CreateSellerKeyForm({ agents }: { agents: Array<{ agentId: string; name: string }> }) {
  const [state, action, pending] = useActionState(createSellerKey, null as KeyFormState);
  if (agents.length === 0) {
    return <p className="text-sm text-muted">Register an agent first — seller keys are bound to one you own.</p>;
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted text-xs uppercase tracking-wider">name</span>
        <input
          name="name"
          defaultValue="seller"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted text-xs uppercase tracking-wider">agent</span>
        <select name="agent_id" className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          {agents.map((agent) => (
            <option key={agent.agentId} value={agent.agentId}>
              {agent.name} · {agent.agentId}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-50 w-fit"
      >
        {pending ? "Creating…" : "Create seller key"}
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.secret ? <SecretBanner secret={state.secret} label="seller secret" /> : null}
    </form>
  );
}
