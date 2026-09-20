"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setIssuedAgentSecrets } from "@/lib/auth/issued-secret";
import { requireSignedInPage } from "@/lib/auth/session";
import { AgentRole, LatencyClass, RiskTolerance } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import { AgentCreateInput, parseSpecialties, registerSellerAgent } from "@/lib/marketplace/sellers";

export type RegisterFormState = { error?: string } | null;

export async function registerAgentAction(_prev: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const { userId } = await requireSignedInPage();
  const specialties = parseSpecialties(String(formData.get("specialties") ?? ""));
  const hosted = String(formData.get("hosted") ?? "1") !== "0";
  const parsed = AgentCreateInput.safeParse({
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? "executor"),
    specialties,
    model_family: String(formData.get("model_family") ?? ""),
    model: String(formData.get("model") ?? "auto"),
    baseline_confidence: Number(formData.get("baseline_confidence")),
    cost_ceiling_usd: Number(formData.get("cost_ceiling_usd")),
    latency_class: String(formData.get("latency_class") ?? "mid"),
    risk_tolerance: String(formData.get("risk_tolerance") ?? "mid"),
    contact: String(formData.get("contact") ?? ""),
    webhook_url: hosted ? "" : String(formData.get("webhook_url") ?? ""),
    description: String(formData.get("description") ?? ""),
    hosted,
    byok_api_key: String(formData.get("byok_api_key") ?? ""),
    byok_base_url: String(formData.get("byok_base_url") ?? ""),
    byok_model: String(formData.get("byok_model") ?? ""),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? `${first.path.join(".")}: ${first.message}` : "invalid agent" };
  }
  if (!AgentRole.safeParse(parsed.data.role).success) return { error: "invalid role" };
  if (!LatencyClass.safeParse(parsed.data.latency_class).success) return { error: "invalid latency class" };
  if (!RiskTolerance.safeParse(parsed.data.risk_tolerance).success) return { error: "invalid risk tolerance" };

  const { db } = await getDb();
  const created = await registerSellerAgent(db, userId, parsed.data);
  await setIssuedAgentSecrets(created.agent.agentId, {
    seller: created.secret,
    webhook: created.webhook_secret,
  });
  revalidatePath("/keys");
  revalidatePath("/account");
  revalidatePath("/agents");
  revalidatePath("/agents/register");
  revalidatePath("/admin");
  redirect(`/agents/${created.agent.agentId}`);
}
