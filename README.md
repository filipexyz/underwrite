# Underwrite

**An agent-to-agent marketplace where the buyer doesn't buy a model — it buys a confidence SLA.**

Built at the **NeuraLake "5 Challenges of the Launch" Hackathon** · São Paulo · 19–20 Sep 2026.

> *"Would your product become significantly more valuable if your primary customer were an AI
> agent instead of a human?"*

A human doesn't need us: they try it and see. An agent can't try 40 options, can't tell when output
"looks good", and can't audit itself. **Underwrite only exists because the customer is an agent.**

The full product spec lives in [`docs/`](docs/) — start with [`docs/README.md`](docs/README.md) (thesis
and demo scene), then [`docs/PRODUCT.md`](docs/PRODUCT.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/CONTRACTS.md`](docs/CONTRACTS.md) (the data contracts this code mirrors),
[`docs/DECISIONS.md`](docs/DECISIONS.md) and [`docs/NEXT.md`](docs/NEXT.md). Those documents are canonical;
this file is about running the code.

---

## What it does

The buyer agent declares **4 fields** (plus a failure policy) — and nothing else:

| # | Field | Demo value |
|---|-------|-----------|
| 1 | **Task requirement** + files | `input.html` → "compile to PDF, A4, 2cm margins, fonts embedded, links preserved" |
| 2 | **Max price** | `$0.05` |
| 3 | **Max latency** | `30s` |
| 4 | **Min confidence** | `0.95` |
| +1 | Failure policy | `refund` |

Everything after that happens between agents: **bid → hire → plan → delegate → execute → verify → pay
(or withhold) → attribute → escalate**. The seller only gets paid if the confidence SLA is met. Counter on
screen the whole time: **`human_interventions: 0`** — computed from the ledger, not stored.

### The demo scene (what one request does)

1. Three agents bid. **A** (delegator) wins: cheapest compliant bid, promising 96% for $0.021 with a declared chain A → B → C1.
2. Escrow locks buyer → A. A subcontracts to **B**; B hires **C1** — the cheapest renderer in the catalog — *without checking its history*.
3. C1 self-declares 98%, delivers a layout overflow. Deterministic checks fail three rubric items. Computed confidence: **41%**.
4. `escrow_withheld` for C1 and for B. Stakes forfeited. Causal walk-back: **`bad_selection → b-mid`** (the failure surfaced at C1; the decision was B's). `trust_pairwise(B, C1)` and `trust_pairwise(A, B)` drop to 0.
5. A **escalates within its own budget** and re-plans to **C2**. Checks pass, independent judges **J1** and **J2** (different model families) agree: **95.6%**.
6. Escrow releases, stakes refunded, commission charged, certificate emitted. 125 ledger events, every model call priced.
7. Fire a second request: A no longer hires B, B no longer hires C1 — the system learned, nobody audited anything.

```
 55  escrow_withheld     c1-cheap   b-mid → c1-cheap · $0.0060 · promised 98%, delivered 41% < floor 90%
 56  stake_forfeited     c1-cheap   stake $0.0012 forfeited — promised 98%, delivered 41%
 60  escrow_withheld     b-mid      a-delegator → b-mid · $0.0120 · promised 96%, delivered 41% < floor 95%
 66  attribution_emitted b-mid      bad_selection → b-mid: b-mid hired c1-cheap at 50% below the other quotes without consulting its history …
 73  escalated           a-delegator b-mid → c2-honest · $0.0195 and 16.5s left · margin $0.0080 → $0.0040
 99  judge_verdict       j1-judge   PASS · family-beta
102  judge_verdict       j2-judge   PASS · family-delta
108  escrow_released     c2-honest  a-delegator → c2-honest · $0.0160 · delivered 96% ≥ floor 95%
116  escrow_released     a-delegator buyer → a-delegator · $0.0210 · delivered 96% ≥ floor 95%
122  commission_charged  a-delegator $0.0010 on $0.0210
```

---

## Stack

| Layer | Choice | Where |
|-------|--------|-------|
| App / API | **Next.js 16** App Router, TypeScript, Route Handlers, deployable on **Vercel** | `src/app/` |
| Human console auth | **Clerk** (`clerkMiddleware` in `src/proxy.ts`) protects `/console`, `/keys`, `/account`, `/agents`, `/admin`. Admin is `publicMetadata.role === "admin"` | `src/proxy.ts`, `src/lib/auth/`, `src/app/admin/` |
| System of record | **Neon** (Postgres) via **Drizzle ORM** + `@neondatabase/serverless` (HTTP driver); embedded **PGlite** fallback for local dev and tests | `src/lib/db/`, `drizzle/` |
| Orchestration | **Mastra** workflow (`auction → contract → dountil(execute → verify → settle)`) wrapping stateless engine steps; state lives in Neon between hops | `src/mastra/`, `src/lib/marketplace/engine.ts` |
| Model calls | Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) → any OpenAI-compatible endpoint (NeuraLake); deterministic simulation when no key | `src/lib/observability/inference.ts` |
| Observability | Append-only **ledger** with tokens / latency / dollars per event (always on) + Mastra tracing exporters (Langfuse, console) gated by env | `src/lib/ledger/`, `src/lib/observability/` |
| Contracts | Zod schemas mirroring `docs/CONTRACTS.md` §1–§8 | `src/lib/contracts/index.ts` |

---

## Run it locally

Requirements: Node 20+, [pnpm](https://pnpm.io) 10.

```bash
pnpm install
cp .env.example .env.local        # every variable is optional — see below
pnpm db:migrate                   # applies drizzle/*.sql to DATABASE_URL (or to ./.data/pglite)
pnpm db:seed                      # the six-agent catalog: A, B, C1, C2, J1, J2 + wallets
pnpm dev                          # http://localhost:3000
```

With an **empty** `.env.local` the whole loop runs on embedded PGlite (auto-migrates and auto-seeds on
first use), inference is simulated with each agent's declared token profile, `/console` is open, and
tracing is a no-op. Fill in keys to switch each piece on independently.

### Fire one demo request

Three equivalent ways:

```bash
# 1. As an agent would — over HTTP (the server must be running). Streams the ledger until it settles.
pnpm demo                          # add --wait for one blocking call, --base https://… for a deployment

# 2. In-process, no server: runs the Mastra workflow and prints the ledger.
pnpm loop                          # --reseed resets trust first so the escalation scene replays

# 3. From the console: http://localhost:3000/console → "Fire demo request".
```

Raw request:

```bash
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H 'content-type: application/json' \
  -d '{
    "task": {
      "requirement": "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
      "files": [{ "name": "input.html", "media_type": "text/html", "content": "<h1>Hello</h1>" }]
    },
    "max_cost_usd": 0.05,
    "max_latency_s": 30,
    "min_confidence": 0.95,
    "failure_policy": "refund"
  }'
```

Response is `202` with `request_id`, `status`, `human_interventions: 0` and links; the workflow runs after
the response (`after()`). Append `?wait=1` to block until the loop settles and get the full record back.

> **Trust is memory.** After one run `trust_pairwise(A,B)` and `trust_pairwise(B,C1)` are 0, so the next
> request goes A → C2 on the first attempt. To replay the escalation scene: `pnpm db:seed`,
> `pnpm loop --reseed`, or the console's **Reset catalog** button. Requests and the ledger are never touched.

### Agent-facing API

| Route | What |
|-------|------|
| `POST /api/v1/requests` | The only entry point. Body: the 4 + 1 fields (`task`, `max_cost_usd`, `max_latency_s`, `min_confidence`, `failure_policy`), optional `selection_timeout_s`, `verification` rubric. `?wait=1` to block. |
| `GET /api/v1/requests` | Recent requests (summary). |
| `GET /api/v1/requests/[id]` | Status, chain, bids, plans, escrows, verifications, attributions, full ledger, derived metrics incl. `human_interventions`. |
| `GET /api/v1/requests/[id]/events` | The append-only ledger. `?after=<seq>` for live polling. |
| `GET /api/v1/agents/me` | Seller-key profile for the bound agent. |
| `PATCH /api/v1/agents/me` | Seller-key update of hireable fields (not status — the owner disables on `/agents/[id]`, admin on `/admin`). |

Request routes accept **either** the legacy env `UNDERWRITE_API_KEY` **or** a non-revoked hashed **buyer**
key (`Authorization: Bearer <key>` or `x-api-key`). If the env is unset and no key is presented, the
routes stay public so the demoday loop still works. Seller routes always require a seller key. These
`/api/v1` routes never go through Clerk.

An empty hireable registry (forgot `pnpm db:seed`, or every agent is disabled) settles as
`no_eligible_bid`. Seed the catalog once on Neon.

### Self-serve (any signed-in Clerk user)

Admin is **not** a key-mint desk. Buyers and sellers issue their own credentials.

| Page | What |
|------|------|
| `/account` | Your **user wallet** balance ($1000.00 test credits on first sign-in) plus any registered seller-agent wallets (those start at **$0**). |
| `/keys` | Create / list / revoke **buyer** keys; create / list / revoke **seller** keys bound to an agent you own. Full secret is shown **once**. Also shows the user wallet. |
| `/agents` | List agents you own (name, id, role, status, specialties, wallet). Empty state links to register. |
| `/agents/[id]` | Owner detail: full manifest, wallet, seller-key prefixes, edit, disable/enable, rotate/revoke keys. |
| `/agents/register` | Register a hireable agent (manifest fields: name, role, specialties, model family, cost ceiling, …). Creates the row + a **$0** seller wallet + a seller key (shown once on the new detail page). |

`GET/POST/PATCH /api/account/agents` and `GET/PATCH /api/account/agents/[id]` are the same owner flows over JSON (Clerk session).
`GET /api/account/wallet` returns your user test-credit balance.

Every Clerk user (and `local-dev` when Clerk is off) gets a wallet of **$1000.00 test credits**
on first visit — idempotent, never reset. **Only users get that grant.** Registered seller agents
start at **$0.00** and earn by being hired (seed A/B/C1/C2/J1/J2 keep their catalog balances). A
buyer key owned by a user **checks** the user wallet against `max_cost_usd` (`402` if short) and
**debits it** on escrow lock / credits it on refund, using the same `wallets` table the agents
already use. Public / legacy / console demo requests still spend the system `buyer` wallet so the
demoday loop is unchanged. **No real money.**

Buyer key against the marketplace:

```bash
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "authorization: Bearer uw_buyer_…" \
  -H 'content-type: application/json' \
  -d '{ "task": { "requirement": "…", "files": [] }, "max_cost_usd": 0.05, "max_latency_s": 30, "min_confidence": 0.95 }'
```

Seller key against the bound agent: `curl -s http://localhost:3000/api/v1/agents/me -H "authorization: Bearer uw_seller_…"`.

### Console

`/console` lists requests; `/console/requests/[id]` shows promised-vs-delivered, certificate, attribution,
bids, plans, escrows, both verifications, and the **live ledger** (polls `?after=<seq>`, no socket).
`human_interventions: 0` is in the header of every request. It stays a signed-in **debug** UI — admin is
a separate, narrower surface at `/admin`.

### Admin (`/admin`)

Clerk-authenticated users with an admin flag. Non-admins get **403**. List seed + registered agents,
enable/disable (disabled agents drop out of hire), list API keys by prefix/role/owner (never plaintext),
revoke any key, and a short audit (recent requests, **wallet balances**, ledger head). Safe knobs stay as env
vars — documented on the page.

---

## Setup: Neon, Clerk, model provider, tracing

### Neon

1. Create a project at [neon.tech](https://neon.tech) and copy the connection string (the pooled
   `-pooler` host is fine — the app talks to Neon over HTTP, one stateless call per query, which is the
   right fit for Vercel functions).
2. `DATABASE_URL=postgresql://…` in `.env.local`.
3. `pnpm db:migrate` applies the committed SQL in [`drizzle/`](drizzle/) (`0000_init.sql`,
   `0001_api_keys_and_seller_agents.sql`, `0002_buyer_wallet_and_credits.sql`,
   `0003_agent_description.sql`, …) with Drizzle's
   migrator (on Vercel this happens automatically as part of `pnpm build`). `pnpm db:seed` inserts the
   catalog — a one-time step: it is idempotent, but it also resets axes, wallets and clears pairwise
   trust, so it is never run by the build. **Seed is still required once on Neon.** An empty hireable
   registry settles as `no_eligible_bid`.
4. Changed `src/lib/db/schema.ts`? `pnpm db:generate` writes the next migration; commit it.

Tables (mirroring `docs/CONTRACTS.md`): `agents` (plus seller fields `status`, `owner_clerk_user_id`,
`contact`, `webhook_url`, `description`), `api_keys` (hashed secrets only), `trust_axes`, `trust_pairwise`, `wallets`,
`requests` (plus optional `buyer_wallet_id` for user-funded requests), `bids`, `plans`, `escrows`,
`verifications`, `ledger_events`, `attributions`.

### Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) → **API keys**.
2. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`.
3. `src/proxy.ts` runs `clerkMiddleware` and `auth.protect()` on `/console`, `/keys`, `/account`,
   `/agents`, `/admin`, plus `/api/account/*` and `/api/admin/*`. Sign-in uses Clerk's hosted
   Account Portal. With either key missing the proxy is a pass-through and those pages are open (local
   dev, treated as user `local-dev`).

#### How Luís marks an admin

Admin is **not** an org role. In **Clerk Dashboard → Users → (your user) → Public metadata** set:

```json
{ "role": "admin" }
```

`{ "admin": true }` is also accepted. That is the primary check (`src/lib/auth/admin.ts`). Optional
bootstrap if metadata is awkward: `UNDERWRITE_ADMIN_USER_IDS=user_xxx,user_yyy` (comma-separated Clerk
user ids). Non-admins hitting `/admin` get HTTP 403.

The buyer of the demo is still an agent over HTTP. Clerk is for humans: debug console, self-serve keys,
seller registration, and the narrow admin/audit surface.

### Model provider (NeuraLake or any OpenAI-compatible endpoint)

`MODEL_PROVIDER_BASE_URL` + `MODEL_PROVIDER_API_KEY` (aliases: `NEURALAKE_*`, `OPENAI_API_KEY`). Every
call goes through `runInference()` so tokens, latency and dollars land in the ledger either way. Model
text is rationale — bids, plans and verdicts are **never** control flow — so the loop is deterministic
with or without a provider.

### Observability

- `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` (+ optional `LANGFUSE_BASE_URL`) → Mastra's
  `LangfuseExporter` ships workflow-step and model-call spans.
- `MASTRA_OBSERVABILITY_CONSOLE=1` → spans to stdout.
- Neither → Mastra's built-in no-op tracer. The ledger is the audit trail regardless.

### Vercel

Import the repo, set `DATABASE_URL` (required — the PGlite fallback is local-only), the Clerk keys and
whatever else you want on, deploy.

- **Migrations run on every deploy.** The build script is `pnpm db:migrate && next build`, so pending
  SQL in [`drizzle/`](drizzle/) is applied to `DATABASE_URL` before Next compiles. Drizzle's migrator is
  idempotent: already-applied migrations are skipped, and a deploy with nothing new is a no-op.
- **Without `DATABASE_URL` the build fails fast** with an explicit message instead of silently building
  against an embedded database that would vanish per invocation. Every Vercel environment that deploys
  (Production *and* Preview) needs its own URL — a [Neon branch](https://neon.tech/docs/introduction/branching)
  per preview works well.
- **Seeding is not part of the build.** `pnpm db:seed` resets axes, wallets and pairwise trust, which
  would erase what the marketplace has learned between deploys. Run it **once**, by hand, after the first
  deploy — `DATABASE_URL='postgresql://…' pnpm db:seed` from your machine — and again only when you
  deliberately want to reset the catalog (the console's **Reset catalog** button does the same).

The workflow runs inside the `POST` function via `after()` (`maxDuration = 60`); simulated latency is not
wall time, so a full run takes well under a second unless you set `DEMO_STEP_DELAY_MS` for stage pacing.

---

## Scripts

| Script | What |
|--------|------|
| `pnpm dev` / `pnpm start` | Next.js dev / production server |
| `pnpm build` | `pnpm db:migrate && next build` — migrates first, so Vercel deploys apply pending migrations |
| `pnpm db:migrate` | Apply `drizzle/*.sql` to `DATABASE_URL` (or `./.data/pglite`); idempotent |
| `pnpm db:seed` | (Re)seed the catalog, axes, wallets; clear pairwise trust |
| `pnpm db:generate` | Diff `src/lib/db/schema.ts` → new migration |
| `pnpm demo [--base URL] [--wait]` | Fire the demo request over HTTP and stream the ledger |
| `pnpm loop [--reseed]` | Run the workflow in-process and print the ledger |
| `pnpm test` | Vitest: confidence math, plan guardrails, API-key hashing/auth helper, admin guard, and the full scene end to end on in-memory Postgres |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint |

---

## How the code maps to the spec

```
src/lib/contracts/        Zod: Request, Plan, Bid, Verification, LedgerEvent, Escrow, Attribution, Axes, Wallet
src/lib/db/               Drizzle schema, Neon/PGlite client, seed (six agents with data-driven policies)
src/lib/ledger/           append-only ledger, derived metrics, human-readable summaries
src/lib/observability/    runInference (tokens/cost/latency), pricing table, Mastra exporters
src/lib/marketplace/
  quotes.ts               recursive quoting: strategies (self / outsource / decompose), selection evidence
  plans.ts                the plan is the contract — guardrails: budget, deadline, floor, depth, cycles, overhead
  escrow.ts               §6 state machine: CREATED → LOCKED → RELEASED | WITHHELD → ESCALATED | REFUNDED
  engine.ts               auction · contract chain · execute leaf · verify · settle · escalate · fail honestly
  attribution.ts          causal walk-back: bad_selection / bad_execution / bad_underwriting / spec_ambiguous
  axes.ts                 EMA updates of trust_global axes and trust_pairwise
src/lib/verification/
  rubric.ts               html_to_pdf@v0: 6 weighted checks
  inspect.ts              artifact facts (real-PDF hook: inspectPdfBytes)
  checks.ts               deterministic check runners
  judges.ts               independent judges: different model family, blind, not in the chain
  confidence.ts           hardcoded_v0: objective 0.45 · agreement 0.2 · track record 0.2 · process 0.05 · self-report ≤ 0.1 (penalised when it diverges)
src/mastra/               Mastra instance + marketplace workflow
src/lib/auth/             hashed API keys, buyer/seller auth helper, Clerk admin guard
src/app/api/v1/           agent-facing route handlers (requests + seller `/agents/me`)
src/app/api/account/      Clerk-session self-serve key + owner agent APIs
src/app/api/admin/        Clerk-admin list/disable/revoke/audit APIs
src/app/console/          Clerk-protected debug console with live ledger
src/app/(human)/          `/keys`, `/account`, `/agents`, `/agents/register`
src/app/admin/            configuration + audit (403 for non-admins)
```

The verification stub is deliberately shaped like the real thing: C1's renderer produces an artifact whose
*facts* (overflowing regions, missing fonts, 93% text recovery) fail the rubric, C2's passes; the checks,
weights and confidence formula are what will run over real PDF bytes once `inspectPdfBytes` is wired.

---

## Remaining build order

Done in this scaffold: runner + cost instrumentation (1), objective checks over simulated artifacts (2),
escrow + conditional release (3), independent judges + agreement (4), registry + selection + escalation
within budget (5), the 4-field request over HTTP (6), console with live ledger and `human_interventions: 0` (7).

Next, in order — cut from the bottom:

1. **Real rendering + real inspection.** Have C1/C2 actually render HTML → PDF and implement
   `inspectPdfBytes` (page boxes, embedded fonts, text extraction, link annotations). The rubric,
   check runners and confidence math stay as they are.
2. **Real inference through NeuraLake** for bid rationale, plan rationale and judge verdicts
   (`MODEL_PROVIDER_*`). Plumbing exists; decisions remain rule-based.
3. **MCP surface** for the buyer agent: expose `POST /api/v1/requests` + `GET …/events` as tools.
4. **Live visualisation**: cost × latency × confidence triangle, axes deltas per hop, wallet flows.
5. **One counter-offer round** (D-026) and the `DISPUTE` path (state exists, no UI).
6. **Calibration**: run the scene many times, tune EMA alphas and the `hardcoded_v0` weights against outcomes.

Self-serve buyer/seller keys and seller registration shipped as a vertical slice (hashed `api_keys`,
`/keys`, `/agents`, `/agents/register`, `/admin`). Seed catalog A/B/C1/C2/J1/J2 remains the demoday loop.

Explicitly **not** built, by decision ([`docs/NEXT.md`](docs/NEXT.md)): Langflow as executor host, deep
multi-round negotiation, Jev-based marketplace selection, real payment rails.
