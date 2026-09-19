"use client";

import { useActionState, type ReactNode } from "react";
import { SecretBanner } from "@/components/secret-banner";
import { mintOwnedSellerKey, updateOwnedAgent, type AgentFormState } from "./actions";

const field = "rounded-md border border-border bg-background px-3 py-2 text-sm w-full";

export function EditAgentForm({
  agent,
}: {
  agent: {
    agent_id: string;
    name: string;
    specialties: string[];
    model_family: string;
    cost_ceiling_usd: number;
    webhook_url: string | null;
    description: string | null;
    contact: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updateOwnedAgent, null as AgentFormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="agent_id" value={agent.agent_id} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="name">
          <input name="name" required className={field} defaultValue={agent.name} />
        </Field>
        <Field label="specialties" hint="comma-separated">
          <input name="specialties" required className={field} defaultValue={agent.specialties.join(", ")} />
        </Field>
        <Field label="model family">
          <input name="model_family" required className={field} defaultValue={agent.model_family} />
        </Field>
        <Field label="cost ceiling usd">
          <input
            name="cost_ceiling_usd"
            type="number"
            min={0.001}
            max={10}
            step="0.001"
            className={field}
            defaultValue={agent.cost_ceiling_usd}
          />
        </Field>
        <Field label="webhook url" hint="optional">
          <input name="webhook_url" className={field} defaultValue={agent.webhook_url ?? ""} placeholder="https://…" />
        </Field>
        <Field label="contact" hint="optional">
          <input name="contact" className={field} defaultValue={agent.contact ?? ""} />
        </Field>
        <Field label="description" hint="optional">
          <textarea name="description" rows={3} className={field} defaultValue={agent.description ?? ""} />
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 w-fit"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}

export function MintSellerKeyForm({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [state, action, pending] = useActionState(mintOwnedSellerKey, null as AgentFormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="agent_id" value={agentId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted text-xs uppercase tracking-wider">name</span>
        <input name="name" defaultValue={`${agentName} seller key`} className={field} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-50 w-fit"
      >
        {pending ? "Minting…" : "Rotate / mint seller key"}
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.secret ? <SecretBanner secret={state.secret} label="seller secret" /> : null}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted text-xs uppercase tracking-wider">
        {label}
        {hint ? <span className="normal-case tracking-normal text-muted/80"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
