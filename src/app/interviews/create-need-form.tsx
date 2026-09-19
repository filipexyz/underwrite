"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/app/console/ui";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function CreateNeedForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [questions, setQuestions] = useState("");
  const [requiredFields, setRequiredFields] = useState("");
  const [context, setContext] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/v1/interviews/needs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          brief: {
            goal,
            questions: lines(questions),
            required_fields: lines(requiredFields),
            context,
            success_criteria: successCriteria,
          },
        }),
      });
      const payload = (await res.json()) as { error?: string; need?: { id: string } };
      if (!res.ok) {
        setError(payload.error ?? `create failed (${res.status})`);
        return;
      }
      if (payload.need?.id) router.push(`/interviews/${payload.need.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label="Title" htmlFor="need-title">
        <input
          id="need-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Seller onboarding — rendering SLA"
          className={inputClass}
        />
      </Field>
      <Field label="Goal" htmlFor="need-goal">
        <textarea
          id="need-goal"
          required
          rows={2}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What this interview is for — later used as marketplace / research context."
          className={inputClass}
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Questions to cover (one per line)" htmlFor="need-questions">
          <textarea
            id="need-questions"
            required
            rows={5}
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            placeholder={"What deliverable do you sell?\nHow do you measure confidence?"}
            className={inputClass}
          />
        </Field>
        <Field label="Required fields (one per line)" htmlFor="need-fields">
          <textarea
            id="need-fields"
            required
            rows={5}
            value={requiredFields}
            onChange={(e) => setRequiredFields(e.target.value)}
            placeholder={"deliverable\nconfidence_method"}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Context (optional)" htmlFor="need-context">
        <textarea
          id="need-context"
          rows={2}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Background the interviewer should know."
          className={inputClass}
        />
      </Field>
      <Field label="Success criteria (optional)" htmlFor="need-success">
        <input
          id="need-success"
          value={successCriteria}
          onChange={(e) => setSuccessCriteria(e.target.value)}
          placeholder="All required fields filled, answers specific enough to reuse."
          className={inputClass}
        />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-ink">
          <span>{pending ? "Registering…" : "Register need"}</span>
          <strong>→</strong>
        </button>
      </div>
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1 text-sm">
      <span className="eyebrow !mb-0">{label}</span>
      {children}
    </label>
  );
}
