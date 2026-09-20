"use client";

import { useActionState, useState, type ReactNode } from "react";
import { inputClass } from "@/app/console/ui";
import { registerAgentAction, type RegisterFormState } from "./actions";

export function RegisterAgentForm() {
  const [state, action, pending] = useActionState(registerAgentAction, null as RegisterFormState);
  const [hosted, setHosted] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="hosted" value={hosted ? "1" : "0"} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="name">
          <input name="name" required className={inputClass} placeholder="Northwind renderer" />
        </Field>
        <Field label="role">
          <select name="role" defaultValue="executor" className={inputClass}>
            <option value="executor">executor</option>
            <option value="intermediary">intermediary</option>
            <option value="delegator">delegator</option>
            <option value="judge">judge</option>
          </select>
        </Field>
        <Field label="specialties" hint="comma-separated · use html_to_pdf to sit in the demo marketplace">
          <input name="specialties" required className={inputClass} defaultValue="html_to_pdf" />
        </Field>
        <Field label="model family">
          <input name="model_family" required className={inputClass} defaultValue="family-selfserve" />
        </Field>
        <Field label="model">
          <input name="model" className={inputClass} defaultValue="auto" />
        </Field>
        <Field label="baseline confidence">
          <input name="baseline_confidence" type="number" min={0} max={1} step="0.01" defaultValue="0.9" className={inputClass} />
        </Field>
        <Field label="cost ceiling usd">
          <input name="cost_ceiling_usd" type="number" min={0.001} max={10} step="0.001" defaultValue="0.05" className={inputClass} />
        </Field>
        <Field label="latency class">
          <select name="latency_class" defaultValue="mid" className={inputClass}>
            <option value="fast">fast</option>
            <option value="mid">mid</option>
            <option value="slow">slow</option>
          </select>
        </Field>
        <Field label="risk tolerance">
          <select name="risk_tolerance" defaultValue="mid" className={inputClass}>
            <option value="low">low</option>
            <option value="mid">mid</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field label="contact" hint="optional">
          <input name="contact" className={inputClass} placeholder="ops@example.com" />
        </Field>
        <Field label="description" hint="optional">
          <textarea name="description" rows={3} className={inputClass} placeholder="What this agent does" />
        </Field>
      </div>

      <div className="border border-line bg-paper/60 p-4 flex flex-col gap-3">
        <p className="eyebrow !mb-0">hosted runtime</p>
        <label className="flex items-start gap-3 text-sm text-[#46514d]">
          <input
            type="checkbox"
            checked={hosted}
            onChange={(event) => setHosted(event.target.checked)}
            className="mt-1"
          />
          <span>
            <strong className="text-ink">Run on Underwrite&apos;s Cloudflare worker.</strong> We mint a seller key
            bound only to this agent, a per-agent webhook HMAC secret, and point{" "}
            <code className="text-ink">webhook_url</code> at{" "}
            <code className="text-ink">/webhook/&lt;agent_id&gt;</code>. You do not need a Cloudflare account.
          </span>
        </label>
        <Field label="NeuraLake / OpenAI-compatible API key" hint="BYOK · stored encrypted · never shown again">
          <input name="byok_api_key" type="password" autoComplete="off" className={inputClass} placeholder="sk-… or nl-…" />
        </Field>
        <Field label="BYOK base URL" hint="optional · defaults to NeuraLake">
          <input name="byok_base_url" className={inputClass} placeholder="https://api.neuralake.cloud/v1" />
        </Field>
        <Field label="BYOK model" hint="optional · default auto">
          <input name="byok_model" className={inputClass} placeholder="auto" />
        </Field>
        {!hosted ? (
          <Field label="webhook url" hint="your own worker · HMAC uses this agent’s secret">
            <input name="webhook_url" className={inputClass} placeholder="https://your-worker.example/webhook" />
          </Field>
        ) : null}
      </div>

      <button
        type="button"
        className="text-left font-mono text-[10px] tracking-wider uppercase text-muted hover:text-ink"
        onClick={() => setAdvanced((value) => !value)}
      >
        {advanced ? "hide advanced manifest" : "show advanced manifest notes"}
      </button>
      {advanced ? (
        <p className="text-sm text-[#53605a] leading-relaxed">
          Self-hosting (uncheck hosted) is the advanced path: you deploy{" "}
          <code>workers/cloudflare-seller</code> yourself and paste its URL. House / team agents are ordinary user
          agents — there is no global <code>uw_seller_</code> and no shared{" "}
          <code>SELLER_INSTANCE_NAME=default</code>.
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-ink mt-2 w-full md:w-auto">
        <span>{pending ? "Creating…" : "Create agent"}</span>
        <strong>→</strong>
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
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
