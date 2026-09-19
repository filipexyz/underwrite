"use client";

import { useActionState, type ReactNode } from "react";
import { inputClass } from "@/app/console/ui";
import { SecretBanner } from "@/components/secret-banner";
import { mintOwnedSellerKey, updateOwnedAgent, type AgentFormState } from "./actions";

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
          <input name="name" required className={inputClass} defaultValue={agent.name} />
        </Field>
        <Field label="specialties" hint="comma-separated">
          <input name="specialties" required className={inputClass} defaultValue={agent.specialties.join(", ")} />
        </Field>
        <Field label="model family">
          <input name="model_family" required className={inputClass} defaultValue={agent.model_family} />
        </Field>
        <Field label="cost ceiling usd">
          <input
            name="cost_ceiling_usd"
            type="number"
            min={0.001}
            max={10}
            step="0.001"
            className={inputClass}
            defaultValue={agent.cost_ceiling_usd}
          />
        </Field>
        <Field label="webhook url" hint="optional">
          <input name="webhook_url" className={inputClass} defaultValue={agent.webhook_url ?? ""} placeholder="https://…" />
        </Field>
        <Field label="contact" hint="optional">
          <input name="contact" className={inputClass} defaultValue={agent.contact ?? ""} />
        </Field>
        <Field label="description" hint="optional">
          <textarea name="description" rows={3} className={inputClass} defaultValue={agent.description ?? ""} />
        </Field>
      </div>
      <button type="submit" disabled={pending} className="btn-ink w-full md:w-auto">
        <span>{pending ? "Saving…" : "Save changes"}</span>
        <strong>→</strong>
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
        <span className="eyebrow !mb-0">name</span>
        <input name="name" defaultValue={`${agentName} seller key`} className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className="btn-ghost justify-between w-full md:w-auto">
        <span>{pending ? "Minting…" : "Rotate / mint seller key"}</span>
        <strong>→</strong>
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.secret ? <SecretBanner secret={state.secret} label="seller secret" /> : null}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="eyebrow !mb-0">
        {label}
        {hint ? <span className="normal-case tracking-normal text-muted/80"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
