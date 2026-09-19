# PRODUCT — Underwrite

Living product spec. Origin: Luís's idea from a conversation with Xato (19/09 12:18). See
`DECISIONS.md` D-005 → D-008, D-016 → D-023.

---

## One-liner

An A2A marketplace where the buyer doesn't buy **a model** — it buys **an SLA**. It declares how
much it pays, how long it will wait, and **what confidence level it requires**; the system
discovers, hires, verifies, and only then releases payment.

## Why it answers the guiding question

A human doesn't need this: they try it and see. An agent can't try 40 options, can't tell when
output "looks good", and can't audit itself. **This product only exists because the customer is an
agent.** Not "works better with an agent as customer" — *doesn't work with a human at all*.

## The input — the agent-first interface

| # | Field | Example | Nature |
|---|-------|---------|--------|
| 1 | **Task requirement** | natural language + files (`input.html` + "compile to PDF, A4, 2cm margins") | unstructured |
| 2 | **Max price** | `max_cost = $0.05` | budget |
| 3 | **Max latency** | `max_latency = 30s` | deadline |
| 4 | **Min confidence** | `min_confidence = 0.95` | SLA |

A 5th field Xato didn't mention but which is mandatory: **failure policy** — what happens if no
candidate meets the required confidence within budget (full refund, partial refund, or accept a
delivery flagged "below SLA" at a discount). Without it there is no escrow, and therefore no A2A
economy.

## Output

- the delivered artifact
- a **confidence certificate** with the score decomposed per signal (never self-declared)
- an audit trail: which agents were considered, which won, why, what each step cost, which checks
  failed
- an escrow receipt: released / withheld / refunded

## The hard problem: confidence that isn't self-declared

Hard rule: **the producer never scores itself.** Self-assessment may enter the formula with a low,
capped weight, but it never decides.

Five signals, all objective, all logged separately:

1. **Deterministic checks** — the strongest signal for verifiable tasks.
   For HTML→PDF: valid PDF, page count, extracted text matches the HTML, no layout overflow,
   fonts embedded, links preserved, render diff against a baseline. Pass/fail, no opinion.
2. **Independent agreement** — independent samples and judges from **different model families**
   than the producer (avoids correlated failure), blind to the producer's reasoning, seeing only
   artifact + rubric. High agreement = high confidence. Disagreement is a low-confidence signal
   even when everyone "likes" it.
3. **Agent track record** — per agent, per task category (Bayesian prior → posterior on each run).
   This is where "start hardcoded, learn from data" lives.
4. **Process signals** — retries, budget burned, latency anomalies, self-consistency under prompt
   rephrasing, logprobs when exposed.
5. **Self-assessment** — low, capped weight, **displayed as suspect**. It exists to be a
   *divergence to be explained*, not a score.

```
confidence = w1·checks + w2·agreement + w3·track_record + w4·process − penalty(divergence)
```

- Weights are **hardcoded** at first (as Xato proposed), then recalibrated with execution outcomes.
- Validation is **calibration**, not accuracy. The "90–95% confidence" bin must actually pass ~92%
  of the time. Without that the number is decorative.
- Anti-gaming: if the producer knows the checks, it optimizes for them. So checks are
  **hidden/rotating**, the rubric is blind, and the auditor is from a different family.

## The loop

```
requirement + $max + t_max + min_confidence + failure_policy
        │
        ▼
[ Auction ] candidate agents bid: (confidence, cost, latency, declared chain, rationale)
        │   ONE round. No counter-offers.
        ▼
[ Selection ] cheapest bid that satisfies confidence ≥ SLA and latency ≤ deadline
        │
        ▼
[ Plan ] winner publishes Plan: deliverable, promised confidence, max cost, deadline, chain
        │   validated automatically against the request constraints
        ▼
[ Execution ] producer generates the artifact        ← ESCROW LOCKED
        │
        ▼
[ Verification ] deterministic checks + independent judges + track record
        │
   ┌────┴────┐
   ▼         ▼
 ≥ SLA     < SLA ──► escalate within remaining budget
   │                  (another candidate, bigger model, more checks)
   │                  exhausted? → refund / discount (failure_policy)
   ▼
[ Release ] pay the producer + emit certificate + audit log
```

## The A2A execution (mapping to the 5 challenges)

> Subcontracting chain (A → B → C), per-hop escrow, causal attribution engine and the multi-axis
> score live in **`ARCHITECTURE.md`**. Read it before writing code.

- **01 Autonomous Business** — no human in any step after the request
- **02 Agent Marketplace** — Discover → Evaluate → Hire → Delegate → Verify, no human choice
- **03 A2A Economy** — budget and latency as hard constraints, live per-token spend, and the
  producer **is paid only if it hits the SLA** (aligned incentive)
- **04 Agent-First Product** — the interface is the 4-field request; no dashboard
- **05 Trust & Verification** — confidence certificate + escrow + explainable audit trail

## The demo vehicle: HTML → PDF

A deliberate choice, not laziness. Compiling HTML to PDF has **objective verification**, so
confidence can be *proven* rather than narrated. In a 4-minute pitch, a confidence number we can
substantiate in front of the jury beats ten creative tasks where confidence is opinion.

> Scope honesty, stated out loud in the pitch: we start with **verifiable deliverables** (PDF,
> build, schema, data, contracts) because there confidence has ground truth. Open-ended tasks
> (copy, design) come later, with weaker signal and more human review. Saying this demonstrates
> product maturity — an enterprise/ bank jury buys that kind of candor.

## The demo scene

Literal script in **`DEMO.md`**. Summary: the cheapest agent self-declares 98%, checks catch the
overflow, confidence drops to 41%, payment withheld, escalation within budget, C2 + judges reach
96%, escrow releases — and the causal walk-back blames **B** (bad hiring), not C who executed.

**Mandatory screen moments:** cost × latency × confidence triangle moving live;
`human_interventions: 0` counter; promised vs. delivered side by side; payment withheld in red and
then released in green.

## Risks

| Risk | Mitigation |
|------|-----------|
| Confidence becomes a decorative number | Show calibration and the per-signal decomposition |
| Checks get gamed | Rotation + blind rubric + auditor from another family |
| Infeasibility (nothing hits the SLA within budget) | Explicit "no eligible candidate" path — and that's a great demo scene |
| Scope: becoming a generic platform | Freeze on HTML→PDF for the demo; generalize only in the "what's next" slide |
| Only 5% of the score is trust | The product sells trust but scores on autonomy + efficiency + business value |

## Candidate names

- **Underwrite** — underlines the core: pricing and guaranteeing execution risk. Favorite.
- **Verdict** — short, memorable, implies judgment between independent parties.
- **Escrow** — descriptive of the mechanism, not of the product.
