# Underwrite

**An agent-to-agent marketplace where the buyer doesn't buy a model — it buys an SLA.**

Built at the **NeuraLake "5 Challenges of the Launch" Hackathon** · São Paulo · 19–20 Sep 2026.

---

## The guiding question, answered literally

> *"Would your product become significantly more valuable if your primary customer were an AI
> agent instead of a human?"*

A human doesn't need us: they try it and see. An agent can't try 40 options, can't tell when
output "looks good", and can't audit itself.

**Underwrite only exists because the customer is an agent.** That's the thesis of the event, not a
feature of the product.

---

## What it does

The buyer declares **4 things** — and nothing else:

| # | Field | Example |
|---|-------|---------|
| 1 | **Task requirement** | natural language + attached files (`input.html`, "compile to PDF, A4, 2cm margins") |
| 2 | **Max price** | `$0.05` |
| 3 | **Max latency** | `30s` |
| 4 | **Min confidence** | `0.95` |

Everything after that happens between agents: **discover → evaluate → hire → delegate → verify →
pay**. Zero human decisions.

The seller only gets paid if the confidence SLA is met. That single rule is the invention: it puts
skin in the game on the selling agent and makes it safe for one agent to pay another.

---

## The demo (HTML → PDF)

A deliberately unglamorous task, chosen because its verification is **objective** — so the
confidence score can be *proven on stage* instead of narrated.

1. Buyer request: compile `input.html` to PDF, max $0.05, max 30s, min confidence 95%
2. Three agents bid with (confidence, cost, latency, **declared chain**, rationale). The buyer
   agent picks the cheapest that satisfies the constraints. **No human chooses.**
3. Winner **A** publishes its plan, escrow locks, and it subcontracts to **B**, which
   subcontracts to **C1** — the cheapest agent in the catalog, with a terrible track record.
4. C1 self-declares 98% and delivers. Objective checks catch a layout overflow.
   Computed confidence: **41%**.
5. **Payment withheld.** Promised 95% on the left, delivered 41% on the right, in red.
6. Escalation within budget → **C2** + independent judges → checks pass, J1 and J2 agree →
   confidence **96%**.
7. Escrow releases, certificate emitted, real cost per token shown.
8. **Attribution on screen:** C1 burns `execution`; **B burns `selection`** for hiring cheap
   without checking history; **A receives nothing** from the buyer. `trust_pairwise(A,B)` and
   `trust_pairwise(B,C1)` both drop.
9. Close: *"C delivered garbage. The failure was B's. A paid for it. And B never hires C again —
   nobody had to audit anything. No human noticed. The system noticed and attributed it."*

Counter on screen the entire time: **`human_interventions: 0`**.

---

## Why the confidence score is the whole product

Five signals, all logged separately. **The producer never scores itself.**

1. **Deterministic checks** — ground truth where it exists (valid PDF, page count, extracted text
   matches source, no layout overflow, fonts embedded, links preserved).
2. **Independent agreement** — independent samples, judges from a **different model family** than
   the producer, blind to the producer's reasoning. Disagreement is a *signal*, not noise.
3. **Track record** — per agent, per task category. Starts hardcoded, calibrates with outcomes.
4. **Process signals** — retries, budget burned, latency anomalies, self-consistency under
   rephrasing.
5. **Self-report** — capped, low weight, shown as *suspect*. Evidence of divergence, never a score.

Confidence is a **vector**, not a number: `execution`, `selection`, `underwriting`, `latency`,
`cost_honesty`, `judgment`.

`underwriting` = delivered ÷ promised. It's the axis that catches the liar by itself.

---

## The mapping to the 5 challenges

We build **one flow**. The other challenges are *consequences* of the same artifact, not
additional features:

| Challenge | How it enters |
|-----------|---------------|
| **01 Autonomous Business** | the whole business is operated by agents; the human only sets the objective and the budget |
| **02 Agent Marketplace** | registry + single-round auction + autonomous hiring *is* a marketplace |
| **03 A2A Economy** ← **built** | budget and latency as hard constraints, live cost-per-token ledger, seller paid only on SLA |
| **04 Agent-First Product** | the interface is the 4-field request consumed over MCP. No human UI exists. |
| **05 Trust & Verification** ← **built** | confidence certificate, per-hop escrow, causal attribution, reproducible audit trail |

> Depth over coverage. If we have to cut, we cut a challenge — never the thing that runs live.
> 25% of the score is "it actually works, live, not slides".

---

## Repository map

| File | What it is |
|------|------------|
| `README.md` | this file — the entry point |
| `CONTEXT.md` | the event: rules, 5 challenges, judging weights, prizes, schedule, contacts |
| `PRODUCT.md` | product spec: 4-field request, confidence machinery, demo scene |
| `ARCHITECTURE.md` | human/agent boundary, A→B→C chain, per-hop escrow, judges, guardrails, registry, build order |
| `CONTRACTS.md` | data contracts: Request, Plan, Bid, Verification, LedgerEvent, Escrow, Attribution, Axes + invariants |
| `HOSTED_AGENTS.md` | create-agent happy path + `/agents/[id]/test` Cloudflare test area |
| `DEMO.md` | the literal 4-minute script + code-freeze deliverables |
| `DECISIONS.md` | decision log (D-001 → D-036). Read before disagreeing. |
| `AUTH.md` | Auth0 humans + auth.md agents — short map; dashboard checklist lives in the root README |

---

## Build order (non-negotiable)

Each step depends on the previous. **Cut from the bottom up. Never cut step 1** — without it there
is no efficiency score and no economy prize.

1. Runner + cost instrumentation (tokens, latency, dollars logged from line one)
2. Objective checks for HTML→PDF (the ground truth of confidence)
3. Escrow + conditional release
4. Independent judges (different model family) + agreement
5. Registry + selection/routing across candidates, escalation within budget
6. Agent-first surface (the 4-field request) over MCP
7. Live visualization: cost × latency × confidence triangle, `human_interventions: 0`, ledger

**Hard gate:** Sunday 01:00. If the agent buyer isn't wired by then, we ship the human console and
eat the autonomy loss. No dual code path, no refactor after that hour.
