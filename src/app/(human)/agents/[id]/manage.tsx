"use client";

import { useActionState, type ReactNode } from "react";
import { inputClass } from "@/app/console/ui";
import { SecretBanner } from "@/components/secret-banner";
import { mintOwnedSellerKey, updateOwnedAgent, updateOwnedRuntime, type AgentFormState } from "./actions";

export function EditAgentForm({
  agent,
  hosted = false,
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
  hosted?: boolean;
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
        {hosted ? (
          <p className="text-sm text-[#53605a] md:col-span-2">
            Webhook URL is owned by the hosted runtime. Switch to self-hosted below if you want to paste your own
            worker URL.
          </p>
        ) : (
          <Field label="webhook url" hint="self-hosted worker">
            <input name="webhook_url" className={inputClass} defaultValue={agent.webhook_url ?? ""} placeholder="https://…" />
          </Field>
        )}
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

export function RuntimeForm({
  agentId,
  runtime,
}: {
  agentId: string;
  runtime: {
    kind: string;
    webhook_url: string | null;
    byok_configured: boolean;
    byok_base_url: string | null;
    byok_model: string | null;
    provisioned: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateOwnedRuntime, null as AgentFormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="agent_id" value={agentId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="runtime">
          <select name="kind" defaultValue={runtime.kind} className={inputClass}>
            <option value="hosted">hosted (Underwrite Cloudflare worker)</option>
            <option value="self_hosted">self-hosted (your worker)</option>
          </select>
        </Field>
        <Field label="self-hosted webhook url" hint="ignored while hosted">
          <input name="webhook_url" className={inputClass} defaultValue={runtime.webhook_url ?? ""} placeholder="https://…" />
        </Field>
        <Field label="BYOK API key" hint={runtime.byok_configured ? "configured · paste to replace" : "optional"}>
          <input name="byok_api_key" type="password" autoComplete="off" className={inputClass} placeholder="sk-… or nl-…" />
        </Field>
        <Field label="BYOK base URL">
          <input name="byok_base_url" className={inputClass} defaultValue={runtime.byok_base_url ?? ""} placeholder="https://api.neuralake.cloud/v1" />
        </Field>
        <Field label="BYOK model">
          <input name="byok_model" className={inputClass} defaultValue={runtime.byok_model ?? ""} placeholder="auto" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-[#46514d]">
          <input type="checkbox" name="clear_byok" value="1" />
          clear BYOK
        </label>
        <label className="flex items-center gap-2 text-sm text-[#46514d]">
          <input type="checkbox" name="rotate_webhook_secret" value="1" />
          rotate webhook HMAC secret
        </label>
        <label className="flex items-center gap-2 text-sm text-[#46514d]">
          <input type="checkbox" name="re_provision" value="1" />
          re-provision Durable Object
        </label>
      </div>
      <button type="submit" disabled={pending} className="btn-ink w-full md:w-auto">
        <span>{pending ? "Saving runtime…" : "Save runtime"}</span>
        <strong>→</strong>
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.webhook_secret ? <SecretBanner secret={state.webhook_secret} label="webhook HMAC secret" /> : null}
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
