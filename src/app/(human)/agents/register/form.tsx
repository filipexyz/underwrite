"use client";

import { useActionState, type ReactNode } from "react";
import { registerAgentAction, type RegisterFormState } from "./actions";

const field = "rounded-md border border-border bg-background px-3 py-2 text-sm w-full";

export function RegisterAgentForm() {
  const [state, action, pending] = useActionState(registerAgentAction, null as RegisterFormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="name">
          <input name="name" required className={field} placeholder="Northwind renderer" />
        </Field>
        <Field label="role">
          <select name="role" defaultValue="executor" className={field}>
            <option value="executor">executor</option>
            <option value="intermediary">intermediary</option>
            <option value="delegator">delegator</option>
            <option value="judge">judge</option>
          </select>
        </Field>
        <Field label="specialties" hint="comma-separated · use html_to_pdf to sit in the demo auction">
          <input name="specialties" required className={field} defaultValue="html_to_pdf" />
        </Field>
        <Field label="model family">
          <input name="model_family" required className={field} defaultValue="family-selfserve" />
        </Field>
        <Field label="model">
          <input name="model" className={field} defaultValue="auto" />
        </Field>
        <Field label="baseline confidence">
          <input name="baseline_confidence" type="number" min={0} max={1} step="0.01" defaultValue="0.9" className={field} />
        </Field>
        <Field label="cost ceiling usd">
          <input name="cost_ceiling_usd" type="number" min={0.001} max={10} step="0.001" defaultValue="0.05" className={field} />
        </Field>
        <Field label="latency class">
          <select name="latency_class" defaultValue="mid" className={field}>
            <option value="fast">fast</option>
            <option value="mid">mid</option>
            <option value="slow">slow</option>
          </select>
        </Field>
        <Field label="risk tolerance">
          <select name="risk_tolerance" defaultValue="mid" className={field}>
            <option value="low">low</option>
            <option value="mid">mid</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field label="contact" hint="optional">
          <input name="contact" className={field} placeholder="ops@example.com" />
        </Field>
        <Field label="webhook url" hint="optional · plan invites later">
          <input name="webhook_url" className={field} placeholder="https://…" />
        </Field>
        <Field label="description" hint="optional">
          <textarea name="description" rows={3} className={field} placeholder="What this agent does" />
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 w-fit"
      >
        {pending ? "Registering…" : "Register agent + mint seller key"}
      </button>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
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
