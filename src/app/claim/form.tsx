"use client";

import { useActionState } from "react";
import { submitClaim, type ClaimFormState } from "./actions";

export function ClaimForm({ claimAttemptToken }: { claimAttemptToken: string }) {
  const [state, action, pending] = useActionState(submitClaim, null as ClaimFormState);
  return (
    <form action={action} className="flex flex-col gap-4 max-w-md">
      <input type="hidden" name="claim_attempt_token" value={claimAttemptToken} />
      <label className="flex flex-col gap-2">
        <span className="eyebrow !mb-0">6-digit code</span>
        <input
          name="user_code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          required
          className="border border-ink bg-paper px-3 py-2 font-mono text-lg tracking-[0.3em]"
          placeholder="123456"
        />
      </label>
      {state?.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state?.ok ? (
        <p className="text-sm text-teal">
          Claimed. The agent can stop polling — registration <span className="mono">{state.registrationId}</span>.
        </p>
      ) : (
        <button type="submit" className="btn-ink w-fit" disabled={pending}>
          {pending ? "Confirming…" : "Confirm claim"}
        </button>
      )}
    </form>
  );
}
