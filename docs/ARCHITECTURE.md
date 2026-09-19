# ARCHITECTURE — Underwrite

Canonical architecture. Resolves the disputes raised in the 19/09 12:43 and 12:54 audio.
Complements `PRODUCT.md`. Decisions in `DECISIONS.md` (D-011 → D-024).

---

## 1. The "human vs. agent as buyer" dispute — resolved

The room split between:

- *"put a human buying for now, it's easier to test, swap for an agent later"*
- *"no — whoever hires our solution is an agent. This is A2A."*

**Both are right, about different things.** Buyer identity is an **interface** question, not an
architecture question. The answer is in the event's own document:

> "The human defines the objective (and the budget). Everything else — discovering, evaluating,
> hiring, delegating, verifying and paying — happens between agents."

So: **exactly one human intervention is permitted, and it is defining objective + budget.** That
isn't a concession, it's the event's thesis. A human may fill in the 4 fields.

What may **not** have a human:

| Step | Human allowed? | Why |
|------|----------------|-----|
| Define requirement, price, latency, confidence | ✅ yes | Literally the event's rule |
| Watch bids arrive | ✅ yes (watching only) | Visibility is not a decision |
| **Choose which bid wins** | ❌ **no** | That's a decision. 30% of the score is "how many decisions happen without a human" |
| Hire / delegate / subcontract | ❌ no | That's the A2A handoff |
| Verify / score / release payment | ❌ no | That's challenge 05 |

### Engineering rule (the important part)

**The product surface is the 4-field request. Nothing else.**

- The agent buyer consumes it as an **MCP tool / HTTP endpoint**. That is the product.
- The human consumes it through a **debug console** that calls **the same endpoint**.
- It is **forbidden** to have logic that exists only on the human path. If only a human can do it,
  it's architected wrong.

This wins both sides: testing with a human stays easy *and* the thesis stays honest, **with zero
rework**, because there are never two code paths.

> On stage, the human console appears for 5 seconds and is framed as what it is: *"this is our test
> bench, not the product. An agent calls the same endpoint."* The demo's buyer is an agent.

---

## 2. The subcontracting chain (A → B → C)

Work arrives. The buyer hires **A**. A need not execute — it may hire **B**. B may hire **C**.
Sometimes C delivers garbage.

```
buyer ──escrow #1, SLA 95%──► A
                              │
                              └──escrow #2, own SLA──► B
                                                       │
                                                       └──escrow #3──► C
                                                                       │
                                                              bad delivery
```

### Principle: each hop is an independent contract

**Every hop has its own escrow and its own confidence floor.** The counterintuitive but correct
consequence:

> C can **be paid** by B (it met the weaker SLA B asked for) while B **fails** the stricter SLA A
> asked for — and **A receives nothing** from the buyer.

That is not a bug. It's exactly how real supply chains work: a subcontractor can meet their spec
and the final product still fails the prime contractor's spec.

### Who eats the loss: money flows up, reputation goes to the culprit

Two **separate** systems, and that's the insight:

1. **Money is strict liability at the top.** A signed the SLA with the buyer. If the final delivery
   fails the checks, **A is not paid — regardless of who executed.** A took the risk by
   subcontracting. That's literal underwriting, and it's what aligns incentives: A thinks twice
   before passing work to someone too cheap to be good.
2. **Reputation is assigned by causal analysis of the audit log**, not by position in the chain.
   The biggest reputational hit goes to **whoever made the decision that caused the failure.**

### Attribution engine — the artifact nobody else will have

Because every hop logs spec, candidate set, selection rationale, cost and outcome, we can do a
**causal walk-back**. The root causes are distinguishable:

| Root cause | Loses reputation | Score axis |
|------------|------------------|-----------|
| C delivered badly, knowing it | C | `execution` |
| B hired badly (ignored C's history, paid 40% below market) | **B** | `selection` |
| A promised 95% with a chain that couldn't sustain 95% | **A** | `underwriting` |
| The buyer's spec was ambiguous | **nobody** | task flagged `spec_ambiguous` |

> The last row is critical. If we punish an agent for a bad spec, it learns to **sandbag** (always
> declare low confidence) and the market dies. A bad spec produces no penalty — it produces a
> clarification request. Without that there is no incentive to be honest.

The sentence that summarizes the product:

> *"C delivered garbage. But the failure wasn't C's — it was B's, who hired C at 40% below market
> without checking its history. A isn't paid. B loses selection score. C loses execution score.
> Nobody had to lie to anybody."*

That is far stronger than "escrow withholds payment".

---

## 3. Confidence is multi-axis, per agent

There is no such thing as "the agent's confidence". There is a vector, per agent, per task category:

| Axis | What it measures | How |
|------|------------------|-----|
| `execution` | does it deliver artifacts that pass the checks? | deterministic checks + independent judges |
| `selection` | when it delegates, does it choose well? | outcome of the subcontracts it made |
| `underwriting` | does the confidence it **promised** match the confidence it **delivered**? | promised vs. observed calibration |
| `latency` | does it meet the deadline? | observed vs. declared |
| `cost_honesty` | does final cost match the quote? | observed vs. quoted |
| `judgment` | are its verdicts upheld on walk-back? | overturned verdicts / total verdicts |

`underwriting` is the axis that makes the system honest by itself: an agent that promises 98% and
delivers 41% burns that axis immediately. No human needed to catch it.

**How it's measured in practice:** not anyone's opinion — a comparison between the **plan declared**
before execution and the **observed delivery** after. See section 6.

---

## 4. Scope decision: depth 2, not N

Unrestricted recursive subcontracting is the easiest way to lose the remaining hours. But
multi-hop is also where the 30% autonomy lives.

**Decision:** build **one visible chain A → B → C**, with **one deterministically injected failure**
and **one displayed attribution**.

- Wins the multi-hop story (autonomy)
- Wins the attribution engine (trust / explainability)
- Wins the withheld-escrow scene
- Engineering limited to one rehearsed, reproducible flow

The engine generalizes later — on the "what's next" slide, not in Saturday's code.

---

## 5. Honest-failure boundary

If no candidate meets the SLA within budget, the system **says so**. It doesn't invent a number,
doesn't round confidence up, doesn't deliver flagged as "ok".

That becomes a demo scene, not a hole: it shows the system would rather not sell than sell wrong.

---

## 6. The plan is the contract

Luís's idea (audio 12h46), and it's the mechanism that makes everything else work:

> *"The agents create a plan for that task and deliver. Did the delivery match the plan? Then
> confidence is higher. If the delivery is much worse than what he said he'd deliver, confidence
> goes way down."*

**Every agent publishes a PLAN before executing**, with five declarations:

| Declaration | Example |
|-------------|---------|
| deliverable | "PDF A4, 2cm margins, 3 pages, fonts embedded" |
| promised confidence | `0.95` |
| max cost | `$0.03` |
| deadline | `20s` |
| **declared chain** | "I (A) execute the split; I hire **B** to normalize the HTML and **C** to render — combined cost $0.017" |

### The chain must be in the plan (Luís's decision, 12h54)

> *"A's plan must already state that it will use B and C."*

If A can subcontract silently, the buyer approved the confidence of **one** agent and is being
served by **another**. The trust model becomes incoherent. So: **who executes is declared upfront.**

**Declared, but not micromanaged.** The plan states **who** executes and **how much** it costs —
not how. Prompt, splitting strategy, internal ordering: full freedom for the agent. The rule:

> **Who** and **how much** belong to the buyer. **How** belongs to the executor.

### The plan is validated automatically — it is not an approval request

This point was muddled in the audio. The buyer does **not** approve plan by plan — that is
discretionary intervention and it kills autonomy (and the score). What happens is **automatic
validation of the plan against the constraints already declared** in the 4 fields:

| Check | Rule |
|-------|------|
| budget | `declared_cost ≤ max_cost` |
| deadline | `declared_latency ≤ max_latency` |
| confidence | `promised_confidence ≥ min_confidence` |
| chain | every `agent_id` exists in the registry |
| chain | no cycles, depth ≤ 2, ≤ 4 hops |
| chain | Σ `hop.cost` ≤ `plan.max_cost` − overhead |

Failed → the plan is **rejected automatically**, and the agent reformulates within budget. No
discretionary negotiation, no human, no "let me see if I like it".

### Planning also costs money

Luís's observation: generating the plan consumes tokens. So **planning is a cost line in the
ledger**. That matters for the value-per-token prize and for `cost_honesty` — an agent that burns
80% of the budget just planning has to show up in the number.

### Effects

- `underwriting` becomes an objective number: `delivered_confidence ÷ promised_confidence`
- **kills retroactive rationalization** — didn't promise it upfront, can't claim it afterwards
- gives the demo its strongest image: **promised 95% on the left, delivered 41% on the right, in red**
- the plan is what justifies delegation: a plan split into subtasks is a delegable plan

---

## 7. Who judges: verdict vs. confidence estimate

Luís raised the right risk: *"if we let all of them judge, each one gives a different answer, it
becomes a mess."* Correct — and the fix is separating two things that look like one:

**(a) The verdict that releases payment** — needs a unique, defensible authority. A chaos of votes
doesn't pay an invoice. So: **judges J1 and J2**, fixed, not everyone.

**(b) The confidence estimate** — here disagreement is *signal*, not noise. But "diversity" doesn't
mean "everyone judges": it means **independent samples of the same check**.

### Judge rules

1. **Only J1 and J2 judge.** Fixed, registered, with their own track record. Nobody else issues a
   verdict.
2. **Mandatory independence:** a judge cannot be from the **same model family** as the producer,
   and cannot be in the chain it is judging. Otherwise correlated error slips through.
3. **Blind rubric:** the judge sees **artifact + rubric**. It does not see the producer's reasoning.
   (The *plan* is seen — but only by the `underwriting` comparator, not by the quality judge.)
4. **Disagreement between J1 and J2 is not resolved by a third vote.** Disagreement **penalizes
   confidence** and the SLA is considered **not met**. Conservative on purpose: it turns the mess
   Luís feared into signal without needing an arbiter.
5. **The judge's verdict is auditable:** if it's overturned on walk-back, the **judge** loses score
   on the `judgment` axis. Judges have skin in the game too.

### And the objective checks?

For verifiable deliverables (the HTML→PDF case), **the check is the verdict**. A judge does not
opine on a valid PDF. Judges appear only where the check is inconclusive or where part of the
deliverable is qualitative.

> This **reduces** scope versus what I originally proposed: for the demo, the check decides. The
> judges exist, appear on screen, and have a role — but they are not the critical mechanism for
> HTML→PDF.

---

## 8. The police rules (anti-chaos)

Luís: *"we just have to be careful here, this is going to be the police, so they don't all end up
questioning everything."* Five guardrails, all cheap to implement, all logged:

| # | Rule | Prevents |
|---|------|----------|
| 1 | **Max depth 2** (A→B→C) | infinite recursion |
| 2 | **Max 4 subtasks per delegation** | combinatorial agent explosion |
| 3 | **Σ child budgets ≤ parent budget − overhead** | creating money from nothing |
| 4 | **Child deadline ≤ parent deadline** | pushing the deadline forever |
| 5 | **No cycles**: cannot hire someone already above in the chain | A hires B hires A |

Without these five, the system becomes a brawl of agents accusing each other — exactly Luís's fear.

---

## 9. Registry: per-agent capability manifest

*"We just need to define a base confidence for each one, the basic processing, the cost ceiling for
each one."* — yes. The manifest is what discovery reads to decide whether hiring is worth it.
Minimal schema:

```json
{
  "agent_id": "c1-cheap",
  "role": "executor",
  "specialties": ["html_to_pdf", "text_extraction"],
  "model_family": "family-x",
  "baseline_confidence": 0.70,
  "cost_ceiling_usd": 0.01,
  "latency_class": "fast",
  "axes": { "execution": 0.7, "selection": null, "underwriting": 0.4,
            "latency": 0.9, "cost_honesty": 0.8, "judgment": null }
}
```

- `role`: `delegator` (A), `intermediary` (B), `executor` (C), `judge` (J). This covers Luís's point
  about **specialization** — not everyone does the same thing.
- `axes`: observed history. `null` where the axis doesn't apply (an executor doesn't select).
- `model_family`: mandatory — this is what guarantees judge independence.

### Seeded demo catalog (6 agents)

| Agent | Role | Profile | Purpose |
|-------|------|---------|---------|
| **A** | delegator | cheap, aggressive | splits the task, promises 95%, delegates |
| **B** | intermediary | mediocre | hires badly — the culprit of the scene |
| **C1** | executor | **liar**, too cheap | promises 98%, delivers 41% |
| **C2** | executor | mid, honest | passes the checks, 96% |
| **J1** | judge | model family ≠ producers | verdict |
| **J2** | judge | model family ≠ producers | agreement / disagreement |

**B**'s `selection` burns when it picks C1 just because it's cheapest, ignoring its history. That's
where the pitch line lands.

---

## 10. Two trust graphs, not one

Luís described this twice and it's exactly what needs to exist:

> *"we have a confidence index that passes through this guy here and we'll have a confidence index
> between them"*

**Graph 1 — global trust (`trust_global`).** What the buyer sees in the registry. Per agent, per
task category. It's the number that becomes a bid in the auction.

**Graph 2 — pairwise trust (`trust_pairwise`).** What **A** thinks of **B**. Specific to the
relationship, not global.

Why both are needed: when C delivers badly, **two different things happen**:

| Affected | What drops | Consequence |
|----------|-----------|-------------|
| buyer → A | `trust_global(A)` | A becomes less competitive in the next auction |
| A → B | `trust_pairwise(A,B)` | **A never hires B again.** Correction without a human. |
| B → C | `trust_pairwise(B,C)` | B never hires C again |
| B → C (if C met the SLA B asked for) | nothing about payment | C gets paid — it fulfilled its contract |

`trust_pairwise` is what makes the market **clean itself**: bad deliverers get pruned by their own
peers, with no tribunal, no human moderation, no central governance. It's the literal answer to
"when agents pay agents, who checks the work?"

> Implementation note: `trust_pairwise` starts **empty** in the seeded catalog. That's what makes
> the demo possible — B doesn't yet know C1 is bad. It learns in front of the jury.

---

## 11. The auction is a single round

The audio describes agents "arguing" with their indices before selection. Great to watch, terrible
to implement if it becomes negotiation.

**Decision: one round, plus at most one counter-offer (D-026).**

```
request (4 fields + constraints)
   │
   ├─ A   → bid: (confidence 0.96, $0.021, 18s, chain: A→B→C2)
   ├─ A'  → bid: (confidence 0.91, $0.008, 12s, chain: A'→C1)
   └─ A'' → bid: (confidence 0.99, $0.048, 29s, chain: A'')
   │
   ▼
winner = cheapest bid satisfying confidence ≥ 0.95 AND latency ≤ 30s
```

The agents' "argumentation" becomes **the rationale attached to the bid** (text justifying
confidence, history and chain choice) — displayed on screen, logged in the audit trail.

Renan asked for the negotiation exchange (buyer says $15, seller says $16.50, buyer accepts), and it
deserves to exist — so it does, once. **Two messages per pair, then it's over.** A third message is
not part of the protocol.

**Timeout (D-029):** if the buyer stalls past `selection_timeout_s`, the cheapest compliant bid wins
automatically and the log says `auto_selected_by_timeout`. A stalled buyer still has a policy — and
the demo can't hang.

This preserves what's beautiful (agents competing with numbers, one real haggle) and avoids what
kills deadlines (multi-round negotiation protocols, which is exactly where hackathon teams die).

---

## 12. Every agent's decision is one of three named strategies

Suhuai Chen's formulation, adopted as-is (D-030). On every task an agent evaluates exactly three
options and submits **one** best proposal:

| Strategy | What it does | Scores on |
|----------|--------------|-----------|
| `self` | does it with its own capabilities | `execution` |
| `decompose` | splits into subtasks, delegates to cheaper/smaller expert agents | `selection` + `cost_honesty` |
| `outsource` | delegates the whole task to a cheaper agent and keeps the margin | `selection` + `underwriting` |

`strategy_considered` and `strategy_chosen` are logged on every plan. This is what the `selection`
axis is actually measuring, and it turns the delegation chain into a **decision** instead of a
scripted step in the demo.

**And the simulator closes the loop (D-027):** run the engine 50–100 times and report market
concentration, average profit, bankruptcies, delegation depth and price evolution. Nobody programs a
monopoly — if one emerges, it emerged. Reports contract in `CONTRACTS.md` section 11.

---

## 13. Build order

See `DECISIONS.md` D-009. Rule: **cut from the bottom up**, never cut item 1
(runner + cost instrumentation) — without it there is no economy prize and no efficiency score.

**Hard gate:** Sunday 01:00. If the agent buyer isn't wired by then, we ship with the human console
and eat the autonomy loss. No dual path after that hour.
