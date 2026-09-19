# NEXT — deferred backlog

Created by D-032 (architecture freeze, 2026-09-19 13:55). **Nothing here gets built tonight.**

Rule: an idea lands here by default. It only leaves this file if it beats the question
*"does this make the flow run live by Sunday 11:00?"* — and the answer has to be yes.

---

## Deferred from the team brainstorm

| Idea | Source | Why it's deferred |
|---|---|---|
| **Langflow** as the executor host (flows exposed as MCP tools) | Giovanni | The critical path is registry + auction + escrow + verification, none of which Langflow provides. It would host the C agents, not the product. Reintroduce only if someone already knows it cold *and* the core loop is already running. |
| **N-depth recursive subcontracting** | — | Depth 2 is enough for the story. Generic engine = hours we don't have. |
| **Dispute UI** | Renan | The `DISPUTE` escrow state exists in the contract; the human-facing screen is a "what's next" slide. |
| **Memory per agent** | Renan | Nice for emergent behavior across runs; the simulator re-instantiates agents instead. |
| **Debt / credit between agents** | Renan | Requires a lending model and a bankruptcy protocol. Real economy, wrong weekend. |
| **Acquisitions** ("A controls 40% of the market") | Renan | Emergent structure is shown through concentration metrics (D-027), not through ownership transfer. |
| **Risk tolerance affecting acceptance** | Renan | Field is in the manifest (D-025) but the decision policy stays the 3 strategies (D-030) for now. |
| **Multi-round negotiation** | Renan | Capped at one counter-offer (D-026). More rounds = dead demo. |
| **Planning subsidy for losing bidders** | Luís | Superseded by the stake mechanism (D-028) — forfeited stakes fund the commission instead. |
| **Open third-party agent registration** | Luís, D-007 | The protocol supports it; the catalog is seeded. Self-registration is a "what's next" slide. |
| **Real payment rails** | — | Simulated wallets only. No real money leaves anything. |
| **Copy/design deliverables as verification targets** | D-008 | Weak signal, no ground truth. Verifiable deliverables first. |
