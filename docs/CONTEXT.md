# CONTEXT — NeuraLake Hackathon

Last updated: 2026-09-19 13:20 (Sat, day 1)

## The event

**"The 5 Challenges of the Launch" Hackathon** — the public launch of the **NeuraLake** inference
platform, the world's first provider focused on **B2A and A2A** (business-to-agent /
agent-to-agent). An unprecedented global initiative, initiated in Brazil by NeuraLake.

- Location: São Paulo
- Dates: 19–20 September
- Numbers: 50 selected builders · 10 teams of 5 · 2 days of continuous build
- 5 A2A challenges · max 3 teams per challenge
- Pitch: 4 minutes live + 2 minutes Q&A at the demoday
- 12–15 mentors across two shifts
- 5-person jury (Oracle executive · NeuraLake founder · investor · Cubo Itaú or early-adopter
  customer · external senior engineer) · simple average · ties broken by degree of A2A autonomy ·
  People's Choice by public vote

## The event's guiding question

> "Would your product become significantly more valuable if your primary customer were an AI agent
> instead of a human?"

> The next trillion users won't be human.

## The transition the challenges explore

- **Today:** Human → Software → AI
- **Tomorrow:** Human → Agent → Agent → Agent
- The human defines the objective (and the budget). Everything else — discovering, evaluating,
  hiring, delegating, verifying and paying — happens between agents, with inference automatically
  routed by NeuraLake.

## The 5 challenges

| # | Challenge | What teams build | Why it matters |
|---|-----------|------------------|----------------|
| 01 | **The Autonomous Business** | A business that operates primarily through agents. End-to-end: agents receive an objective, decide, trigger other agents, deliver a business result. Domains: sales, finance, dev, research, procurement, support. Constraint: humans define the objective; agents run the flow. | The most visual demonstration of the thesis. Likely source of videos and cases for launch week. Product + business profile. |
| 02 | **Agent Marketplace** | An agent receives an objective without having all the needed capabilities → it must autonomously Discover → Evaluate → Hire → Delegate → Verify other agents. Constraint: no human manually picks which agent does each task. E.g. a startup agent hires research, code, design and marketing agents, then evaluates their work. | Exercises discovery and delegation — the core of A2A and the basis of NeuraLake's future agent swarm. |
| 03 | **Agent-to-Agent Economy** | Each agent gets an objective + a limited (simulated) budget and can buy services from other agents. Chain: CEO Agent → Research Agent → Coding Agent → buys inference → QA Agent → delivers. Challenge: maximize value per dollar/token spent, with spend shown in real time. | Puts cost per token at the center — exactly where `model="auto"` and Cross Memory stand out. |
| 04 | **Agent-First Product** | Take an existing product/business (e-commerce, bank, SaaS, logistics, health, legal) and redesign it so **an agent** — not a person — discovers, evaluates, negotiates, buys and uses it. No dashboards, forms or human onboarding: machine-readable offers, negotiable prices, end-to-end callable interfaces. Show the same journey twice: human today vs. agent through your agent-first interface. Constraint: the human never touches the interface after setting the objective. | Directly answers the guiding question. Most accessible for teams that already have a business. |
| 05 | **Agent Trust & Verification** | The trust layer for agent transactions: verification of delivered work, explainable decisions, audit trails, reputation, disputes or escrow. Every decision (which agent was hired, which model was used, why, at what cost) must be recorded and explainable to a human auditor. E.g. a Critic/Auditor agent reviews other agents' work, scores it, releases or withholds payment, and produces a compliance report. | What banks and enterprises will require before adopting A2A. |

## Judging criteria (weights)

| Weight | Criterion | What counts |
|--------|-----------|-------------|
| 30% | Degree of A2A autonomy | How many decisions and handoffs happen without a human |
| 25% | It actually works (demo) | A complete flow running live, not slides |
| 15% | Value per token / efficiency | Use of `model="auto"`, Cross Memory and routing |
| 15% | Business value | Does the product become more valuable with an agent as customer? |
| 10% | Pitch and clarity | 4 min: problem → demo → what comes next |
| 5% | Trust and explainability | Logs, decision rationale, verification between agents |

## Prizes

- **1st, 2nd and 3rd place** — main podium: credits, cash and investor access (composition being
  defined with sponsors)
- **Best use of auto + Cross Memory** — $1,000 in credits + mention in NeuraLake's public benchmark
- **Best Agent Economy** — $1,000 in credits for the best value generated per token
- **People's Choice** — public voting via QR during the demoday
- **All participants** — $100 in credits (60 days) + certificate + community channel access
- **During the event** — NeuraLake inference credits + Oracle-sponsored OCI credits per team

## Schedule

### Saturday 19/09
- 08:30 — Check-in and breakfast
- 09:00 — Opening: Oracle welcome + NeuraLake thesis
- 10:00 — The 5 challenges, rules, criteria presented; **build starts**
- 12:30–13:30 — Lunch break
- 14:00–16:00 — Mentoring (shift 1)
- 16:00–16:30 — Coffee break
- 19:30 — Pizza and orientation
- 20:00 — Building closed

### Sunday 20/09
- 08:30 — Breakfast
- 09:00–11:00 — Hands-on + mentoring shift 2 · pre-demo pitch checkpoint
- **11:00 — Code freeze**: repository, 60s video and short deck
- 12:00–13:00 — Lunch break (note: listed out of order on the official deck)
- 12:30 — **Final GitHub submission**
- 13:30 — **Demoday**: 10 pitches of 4 min + 2 min Q&A
- 16:00 — Awards, official photo and closing

> Real remaining build window: from 19/09 12:15 until 20/09 11:00 (code freeze) ≈ **22h45**.

## Contacts

- Celso Diniz — celso.diniz@neuralake.com.br — +55 (15) 99716-9719
- Katherine Vescovi — katherine@neuralake.com.br — +1 (650) 642-0354

## Our team

- **Challenge declared:** _(to be defined)_
- **Team (5, confirmed):** Luís Filipe · Giovanni Saboya (CFP) · Gabriel (`GabrielID15`) · Renan Jato (M.Sc.) · Suhuai Chen
- **Repository:** _(to be defined)_
- **Stack / available resources:** _(to be defined)_
- **NeuraLake platform + OCI access:** _(to be defined)_

## Luís's thesis

"We're going all in and will deliver a product that fits every challenge."
See `DECISIONS.md` for how we're handling that.

## Canonical files

| File | What it is |
|------|------------|
| `README.md` | entry point — the product in one page |
| `CONTEXT.md` | this file — event rules, challenges, criteria, schedule, contacts |
| `PRODUCT.md` | living product spec (Underwrite): 4-field request, confidence, demo scene |
| `ARCHITECTURE.md` | architecture: human/agent boundary, A→B→C chain, per-hop escrow, judges, guardrails, registry |
| `CONTRACTS.md` | data contracts (Request, Plan, Bid, Verification, Ledger, Escrow, Attribution, Axes) — lets 5 people code in parallel |
| `DEMO.md` | literal 4-minute script + code-freeze deliverables |
| `DECISIONS.md` | decision log (D-001 → D-030) — read before disagreeing |
| `TEAM-IDEAS.md` | where each teammate's idea landed — every contribution traced to a decision |
