"use server";

import { completeUserClaim } from "@/lib/auth/auth-md";
import { requireSignedInPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";

export type ClaimFormState = { error?: string; ok?: boolean; registrationId?: string } | null;

export async function submitClaim(_prev: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  const identity = await requireSignedInPage();
  const userCode = String(formData.get("user_code") ?? "");
  const claimAttemptToken = String(formData.get("claim_attempt_token") ?? "");
  if (!claimAttemptToken) return { error: "missing claim attempt — open the link the agent gave you" };
  const { db } = await getDb();
  const result = await completeUserClaim(db, {
    userCode,
    claimAttemptToken,
    userId: identity.userId,
    email: identity.email,
  });
  if (!result.ok) return { error: result.error };
  return { ok: true, registrationId: result.registrationId };
}
