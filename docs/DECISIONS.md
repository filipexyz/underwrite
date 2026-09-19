# DECISIONS — Underwrite

Format: decision, context, reason, date. Record reversals too.

---

## D-001 · Event document studied and canonized

**Date:** 2026-09-19 · **Status:** done

The hackathon PDF ("The 5 Challenges of the Launch") was read and distilled into `CONTEXT.md`.
That file is now the single source of truth for rules, challenges, criteria, prizes and schedule.

**Consequence:** any rule question is answered by `CONTEXT.md`, not by conversational memory.

---

## D-002 · Don't pick 1 of the 5 challenges — build 1 product that spans all 5

**Date:** 2026-09-19 · **Status:** decided

**Context:** the event requires teams to pick **one** challenge (max 3 teams per challenge), but the
judging criteria are cross-cutting and none of them rewards "picking one".

**Reading:** the 5 challenges aren't 5 products — they're 5 *dimensions* of the same A2A system.
One well-designed artifact exercises all of them.

**Decision:** pick **one anchor challenge** (what the demo *is*) and treat the other four as
mandatory layers of the same artifact. This maximizes the 30% autonomy + 15% value-per-token + 5%
trust criteria without diluting scope, because it's **one** flow, not five demos.

**Trade-off accepted:** the real risk isn't "missing a challenge", it's **not shipping a flow that
runs live** (25% of the score). Depth > coverage. If we must cut, we cut a challenge — never the
thing that runs.

---

## D-003 · OPEN: which anchor challenge

**Date:** 2026-09-19 · **Status:** open — effectively resolved by D-024 (anchor = 03, built with 05)

---

## D-004 · OPEN: missing context

**Date:** 2026-09-19 · **Status:** open

Still unknown: challenge declared at check-in, the 5 team members and their skills, existing
repo/base, and NeuraLake API + OCI credit access. See D-010.

---

## D-005 · The product is a confidence SLA, not a model

**Date:** 2026-09-19 12:18 (audio) · **Status:** decided — becomes the product's spine
**Source:** Luís's idea from a conversation with Xato

The buyer declares **4 things** and nothing more: (1) the task requirement (natural language +
files), (2) how much it will pay, (3) how long it will wait, (4) **what confidence level it
requires**.

The system then discovers, hires, verifies and only releases payment if the confidence SLA is met.
Full spec in `PRODUCT.md`.

**Why this is strong:** it answers the guiding question literally — it's not a product that works
*better* with an agent as customer, it's a product that **only exists** because the customer is an
agent. A human tests and sees. An agent doesn't know when output "looks good" and can't release
payment on its own.

**Point Luís raised (correct):** confidence **cannot be self-declared** by the producing model.
Self-assessment enters with a low, capped weight; objective signals + independent reviewers decide.
This is the project's hard problem, and it's exactly why trust is worth only 5% of the score while
autonomy is worth 30%.

---

## D-006 · The learning layer starts hardcoded and calibrates with data

**Date:** 2026-09-19 12:18 · **Status:** decided

Confidence formula weights start **hardcoded**. Every execution records the real outcome
(passed/failed the checks) and we readjust. The success metric is **calibration**, not accuracy: the
"90–95% confidence" bin must pass ~92% of the time.

Luís's benchmark/classification idea lands here: each agent has its own variable history, and the
score is specific to an agent and a task category.

---

## D-007 · Open marketplace, **seed catalog we control**

**Date:** 2026-09-19 12:20 · **Status:** decided

Luís proposed a marketplace where third parties list their agents to buy and sell services. The
vision is right — that's challenge 02 at its core. But with ~22h to build, an open marketplace is a
scope trap.

**Decision:** the **protocol** is real (registry, discovery, evaluation, hiring, escrow,
verification); the **catalog** is seeded by us — 5 to 8 registered agents, including 1 or 2
deliberately bad/lying ones so the demo has something to catch.

**How it becomes pitch, not an excuse:** *"the marketplace is open by construction; at the hackathon
we seed the catalog because there is no supply yet. The protocol already supports third parties."*

---

## D-008 · Demo vehicle task: HTML → PDF

**Date:** 2026-09-19 12:18 · **Status:** decided

Xato's suggestion, and it's the right one: compiling HTML to PDF has **objective verification**
(valid PDF, pages, extracted text matches, overflow, fonts, links). So the confidence number can be
**proven** live instead of narrated.

**Trade-off stated explicitly in the pitch:** we start with verifiable deliverables (PDF, build,
schema, data, contracts) because confidence has ground truth there. Open-ended tasks (copy, design)
come later with weaker signal. Saying this demonstrates product maturity to an enterprise jury.

---

## D-009 · Dependency hierarchy: no pretty layer without a working base

**Date:** 2026-09-19 12:30 · **Status:** decided

Non-negotiable build order (each item depends on the previous):

1. **Runner + cost instrumentation** — 1 agent, 1 task, tokens/time/dollars logged from line one.
   Without it there is no 15% efficiency score and no economy prize.
2. **Objective checks** for HTML→PDF — the ground truth of confidence.
3. **Escrow + conditional release** — the producer is paid only if it meets the SLA.
4. **Independent auditor** (different model family) + agreement across reviewers.
5. **Registry + selection/routing** across candidates, with in-budget escalation.
6. **Agent-first surface** (the 4-field request) — born agent-first, needs no UI.
7. **Live visualization**: cost × latency × confidence triangle + human-intervention counter + ledger.

If time runs short, cut from the bottom up. The top (7) is what sells, but it only exists with 1–5.

---

## D-010 · Still unanswered: declared challenge and teammates

**Date:** 2026-09-19 · **Status:** open

Still unknown: challenge declared at check-in, the 5 team members and skills, existing repo/base, and
NeuraLake API + OCI credit access. See D-004.

---

## D-011 · A human buyer is allowed, but only at the objective + budget boundary

**Date:** 2026-09-19 12:43 (audio) · **Status:** decided — breaks the room's deadlock

The room split: "put a human buying for now, it's easier to test" vs. "whoever hires is an agent,
this is A2A".

**Resolution:** the event document already defines the exact point of human intervention — *"the
human defines the objective (and the budget). Everything else happens between agents."* So a human
may fill in the 4 fields and watch. What it may **not** do is choose the winning bid, hire, verify or
release payment — that's the 30% autonomy criterion.

**Engineering rule that prevents rework:** the product surface is the 4-field request and nothing
else. The agent consumes it over MCP/HTTP; the human through a console that calls **the same
endpoint**. Logic that exists only on the human path is forbidden. Semantically: human buyer and
agent buyer become the *same* client, so swapping one for the other is config, not a refactor.

Luís's technical framing in the audio ("it'll be an MCP we drop in place of an agent") is correct.

---

## D-012 · Chain A → B → C with one escrow per hop, and money flows up

**Date:** 2026-09-19 12:43 · **Status:** decided

A may subcontract B, B may subcontract C. **Each hop is an independent contract, with its own escrow
and its own confidence floor.**

Deliberate consequence: C can **be paid** by B (it met the weaker SLA B asked for) while B **fails**
A's SLA, and **A receives nothing** from the buyer. That's exactly how real supply chains work, not a
bug.

**Two separate systems:**
- **Money:** strict liability at the top. A signed the SLA with the buyer, so A eats the loss
  regardless of who executed. That's what aligns incentives — A thinks twice before passing work to
  someone too cheap to be good.
- **Reputation:** assigned by causal walk-back of the audit log, not by position in the chain.

---

## D-013 · Confidence is multi-axis, not one number per agent

**Date:** 2026-09-19 12:43 · **Status:** decided

Axes per agent and per task category: `execution`, `selection`, `underwriting`, `latency`,
`cost_honesty`, `judgment`.

`underwriting` = calibration between **promised** and **delivered** confidence. It's the axis that
catches the liar by itself: promising 98% and delivering 41% burns it immediately.

`selection` separates "executes badly" from "delegates badly" — different skills, and an agent that
hires too cheaply without checking history must be penalized on that axis, not on execution.

Anti-sandbagging rule: **an ambiguous buyer spec penalizes nobody** — the task is flagged
`spec_ambiguous` and returned for clarification. Without it, agents learn to always declare low
confidence and the market dies.

---

## D-014 · Subcontracting depth 2, not N

**Date:** 2026-09-19 12:43 · **Status:** decided

Generic recursive subcontracting is the fastest way to lose the remaining hours. But multi-hop is
part of the 30% autonomy.

**Decision:** **one** visible chain A → B → C, with **one deterministically injected failure** and
**one attribution displayed on screen**. No generic N-level engine.

The engine generalizes on the "what's next" slide.

---

## D-015 · Hard gate: Sunday 01:00

**Date:** 2026-09-19 12:50 · **Status:** decided

If the agent buyer isn't wired to the same endpoint as the console by Sunday 01:00, the team ships the
human path and accepts the autonomy loss. **No dual path and no refactoring after that hour.**

---

## D-016 · The plan is the contract (plan-first + promised vs. delivered comparison)

**Date:** 2026-09-19 12:46 · **Status:** decided — the central mechanism of `underwriting`

Every agent publishes a plan **before** executing: deliverable, promised confidence, max cost,
deadline. The escrow locks against the plan. Afterwards the auditor compares promised vs. observed,
axis by axis.

Three gains at once: `underwriting` becomes an objective number; it **kills retroactive
rationalization** (didn't promise it upfront, can't claim it later); and it gives the demo its
strongest image (promised 95% vs. delivered 41%, side by side).

---

## D-017 · Only J1 and J2 judge — and the verdict is separate from the estimate

**Date:** 2026-09-19 12:46 · **Status:** decided

Risk raised by Luís: *"if we let all of them judge, each one gives a different answer, it becomes a
mess"* — correct. Separation:

- **Verdict that releases payment:** a unique, defensible authority → only **J1 and J2**, fixed,
  registered, with their own track record. Open voting doesn't pay an invoice.
- **Confidence estimate:** disagreement is *signal*, not noise. Diversity = independent samples of
  the same check, not "everyone opines".

Rules: judge from a **different model family** than the producer, outside the judged chain, blind
rubric (artifact + rubric, without seeing the producer's reasoning). **Disagreement between J1 and J2
is not resolved by a third vote** — it penalizes confidence and the SLA is considered unmet.
Conservative on purpose: it turns the mess into signal without an arbiter. And judges have skin in
the game — a verdict overturned on walk-back burns their `judgment` axis.

**Honest scope reduction:** for verifiable deliverables like HTML→PDF, **the check is the verdict**.
A judge doesn't opine on an invalid PDF. J1/J2 only enter where the check is inconclusive or on the
qualitative part of the deliverable.

---

## D-018 · Five "police" guardrails

**Date:** 2026-09-19 12:46 · **Status:** decided

Luís's concern: *"so they don't all end up questioning everything"*. Five rules, all logged:

1. Max depth 2 (A→B→C)
2. Max 4 subtasks per delegation
3. Σ child budgets ≤ parent budget − overhead
4. Child deadline ≤ parent deadline
5. No cycles: cannot hire someone already above in the chain

Without them, the system becomes a brawl of agents accusing each other.

---

## D-019 · Agents have roles and a capability manifest in the registry

**Date:** 2026-09-19 12:46 · **Status:** decided

Luís's point about specialization ("A1, A2, A3 to delegate, delegating to C5, because otherwise
everyone does the same thing") lands here: the registry stores `role` — `delegator` / `intermediary`
/ `executor` / `judge` — plus `specialties`, `model_family`, `baseline_confidence`,
`cost_ceiling_usd`, `latency_class` and the axis vector.

`model_family` is mandatory: it's the field that guarantees judge independence.

---

## D-020 · The subcontracting chain must be declared in the plan

**Date:** 2026-09-19 12:54 · **Status:** decided — amends D-016

> *"A's plan must already state that it will use B and C."* — Luís

If A can subcontract silently, the buyer approved the confidence of **one** agent and is served by
**another**. The trust model becomes incoherent. So the plan has **five** declarations: deliverable,
promised confidence, max cost, deadline and **declared chain** (who executes, with combined cost).

**Boundary:** who and how much belong to the buyer; **how** (prompt, splitting strategy, internal
order) is the executor's full freedom. Declaring the chain is not micromanaging execution.

---

## D-021 · The plan is validated automatically, not approved

**Date:** 2026-09-19 12:54 · **Status:** decided

The audio was ambiguous about "me approving the plan". Discretionary plan-by-plan approval is human
intervention → kills autonomy → kills the 30%.

**Decision:** approval = **automatic validation of the plan against the constraints already declared**
in the 4 fields. `cost ≤ max_cost`, `latency ≤ max_latency`, `promised_confidence ≥ min_confidence`,
every chain agent exists in the registry, no cycles, depth ≤ 2. Failed → automatic rejection and the
agent reformulates within budget.

No discretionary negotiation, no "let me see if I like it".

**Planning is also a cost:** generating the plan consumes tokens and appears as its own ledger line.

---

## D-022 · Two trust graphs: global and pairwise

**Date:** 2026-09-19 12:54 · **Status:** decided

- `trust_global(agent, category)` — what the buyer sees. Becomes a bid in the auction.
- `trust_pairwise(A,B)` — what A thinks of B. Specific to the relationship.

When C delivers badly: `trust_global(A)` drops, `trust_pairwise(A,B)` drops (A won't hire B again) and
`trust_pairwise(B,C)` drops (B won't hire C again). There is no central authority — **the market
cleans itself through its own peers**. That's the literal answer to "when agents pay agents, who
checks the work?".

**Demo trick:** `trust_pairwise` starts empty in the seeded catalog. B doesn't know C1 is bad yet —
it **learns in front of the jury**.

---

## D-023 · The auction is a single round

**Date:** 2026-09-19 12:56 · **Status:** decided

Agents bid with (confidence, cost, latency, chain) + a text rationale. **One round, no counter-offers.**
Winner = cheapest bid satisfying the constraints.

The "argumentation" becomes a rationale attached to the bid — displayed and logged, **not**
negotiated. Preserves the beautiful visual (agents competing with numbers) and avoids multi-round
negotiation protocols, which is where hackathon teams die.

---

## D-024 · Scope freeze: build 03 + 05; 01, 02 and 04 are dimensions of the same artifact

**Date:** 2026-09-19 13:05 · **Status:** decided — protects the 25% "it actually works"

In the audio someone says *"if we try to aggregate all 5 at once in development, we'll get lost"* —
that's right, and it's time to agree with it.

**What we build:** one flow — **A2A Economy (03) + Trust & Verification (05)**.

**What we *demonstrate* without building anything new:**

| Challenge | How it enters |
|-----------|---------------|
| 01 Autonomous Business | the whole business runs on agents; the human only sets objective and budget |
| 02 Agent Marketplace | registry + auction + discovery + hiring literally are a marketplace |
| 04 Agent-First Product | the interface is the 4-field request consumed over MCP; there is no human UI |

They aren't features — they're **consequences** of the same artifact. Marginal cost of claiming them:
one slide. Cost of implementing them separately: the entire hackathon.

**Trade-off:** if a judge asks "where is challenge X?", the answer is the screen, not a slide. Which
is why the **human console must be framed as a test bench** — otherwise we accidentally demonstrate
the opposite of 04.

---

## D-025 · Agents are businesses: wallet, capital, P&L, risk tolerance

**Date:** 2026-09-19 13:35 · **Source:** Renan ("Agent Mafia") · **Status:** decided

The registry manifest gains **`wallet`** and **`risk_tolerance`**, and the ledger gains a
**balance sheet per agent**: `capital`, `revenue`, `costs`, `profit`. Agents can accumulate capital,
run at a loss, and go bankrupt.

**Why it matters:** without a balance sheet, Challenge 01 (autonomous business) is cosmetic. With it,
an agent that accepts unprofitable work genuinely dies — and that's a *consequence*, not a rule
someone wrote.

---

## D-026 · One counter-offer is allowed — amends D-023

**Date:** 2026-09-19 13:35 · **Source:** Renan (Buyer "$15" → Seller "$16.50" → "Accepted") ·
**Status:** decided

D-023 was strictly one round. Renan wants the negotiation exchange, and the exchange is genuinely
good on screen.

**Decision:** **one round, plus at most one counter-offer.** Bounded, deterministic, capped at two
messages total per pair. No third message, no open-ended haggling.

Preserves the visual and keeps the demo at 4 minutes. This is the only negotiation change: it's a
constant in the protocol, not a negotiation framework.

---

## D-027 · The simulator: 50–100 transactions and emergent structure

**Date:** 2026-09-19 13:35 · **Source:** Renan · **Status:** decided — highest-value idea in the batch

After the single live transaction, run **50–100 simulated transactions** over the same engine and
plot what emerged: market concentration, average agent profit, bankruptcies, delegation depth,
price evolution, contract failures, average reputation.

**Why this is the pitch:** it turns the claim from "we built an agent marketplace" into
*"we built a sandbox where autonomous agents participate in an economy, and here is the structure
that emerged from their decisions"*. Nobody is told to create a monopoly; you show whether one forms.

**Engineering:** a loop over the engine we already have. No new subsystem.

**Bonus:** it's the robust fallback. If the single live transaction stalls on stage, the batch run is
already computed and the story survives.

---

## D-028 · Stake, commission and the price of lying

**Date:** 2026-09-19 13:35 · **Source:** Luís (who pays for losing plans) + Suhuai (commission) ·
**Status:** decided — closes a real hole

**The problem:** three agents bid, one wins. The two losers burned tokens planning. "We can't work
for free."

**Decision, two parts:**

1. **Bidding costs the bidder its own tokens.** That's the cost of doing business in a market — the
   same as a market maker quoting a price. No subsidy needed for merely losing.
2. **The winner posts a stake**, and the stake is settled against its own promise:
   - fulfilled the promised confidence → **stake refunded**, even if it lost other bids
   - **blew its own promise** (promised 98%, delivered 41%) → **stake forfeited**

**Why the stake is the right instrument:** it prices lying. A model can claim 98% confidence for free
— until the claim has a cost. This is the financial version of the `underwriting` axis, and the two
reinforce each other.

**Where the forfeited stake goes:** funds the marketplace **commission** (Suhuai). The market earns
from bad promises, not from good ones — an incentive structure that only improves quality.

**Also adopted:** the marketplace takes a commission on each settled transaction. This is the revenue
model, required for Challenge 01 and for the 15% business-value criterion.

---

## D-029 · Auto-selection on timeout

**Date:** 2026-09-19 13:38 · **Source:** Luís · **Status:** decided

If the buyer doesn't pick within the window, the plan is selected **automatically**: cheapest
compliant bid. Logged as `auto_selected_by_timeout`.

Removes a live-demo hang, and it's honest — an agent buyer that stalls still has a policy.

---

## D-030 · Every agent's policy is an explicit three-way choice

**Date:** 2026-09-19 13:51 · **Source:** Suhuai Chen · **Status:** decided

Where we had a vague "A may break the task up", Suhuai gives the crisp version. On every task an
agent evaluates exactly three options and submits **one** best proposal:

| Strategy | What it does | Scores on |
|---|---|---|
| `self` | do it with its own capabilities | `execution` |
| `decompose` | split into subtasks and delegate to cheaper/smaller expert agents | `selection` + `cost_honesty` |
| `outsource` | delegate the whole task to a cheaper agent and keep the margin | `selection` + `underwriting` |

`strategy_considered` and `strategy_chosen` are logged per plan. This is what the `selection` axis is
actually measuring, and it makes the delegation chain a *decision* instead of a script.

---

## D-031 · The verification rubric ships with the task — amends "hidden checks"

**Date:** 2026-09-19 13:51 · **Source:** Suhuai Chen · **Status:** decided — correction

We had "hidden/rotating checks" as anti-gaming. Suhuai is more correct: **an agent cannot bid honestly
on a confidence SLA if it doesn't know what's being checked.** Hiding the criteria makes the market
unfair and the bids meaningless.

**Decision:** the **verification rubric is declared in the task** — machine-readable and versioned
(what to check, how, and what counts as passing). Anti-gaming comes from:

- rotating the **instances** inside declared check categories
- the producer never knowing **which sample** the reviewer drew
- the judge being from a different model family (D-017)

**Consequence:** `Request` gains a `verification` block. See `CONTRACTS.md`.

---

## D-032 · Team brainstorm complete; the architecture is frozen

**Date:** 2026-09-19 13:55 · **Status:** decided

All five members submitted their view (`TEAM-IDEAS.md`). Five angles, one system: Renan (economics +
emergent behaviour), Luís (marketplace infrastructure + who pays whom), Suhuai (decision policy +
sources of confidence), Giovanni (underwriting), Gabriel (repo/implementation).

**Nobody proposed a different architecture.** Only two real disagreements existed — who picks the
winner (D-011) and whether negotiation is allowed (D-026) — and both are now decided.

**Therefore: architecture is frozen as of this decision.** From here, changes need a reason that
beats "we have 21 hours left". New ideas go to a `NEXT.md` backlog, not into the build.

This is the most important decision of the day: the failure mode from here is not a bad design, it's
running out of hours with nothing running.
