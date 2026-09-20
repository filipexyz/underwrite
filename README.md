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
[`docs/HOSTED_AGENTS.md`](docs/HOSTED_AGENTS.md) (create-agent happy path),
[`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/AUTH.md`](docs/AUTH.md) and [`docs/NEXT.md`](docs/NEXT.md). Those documents are canonical;
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
| Human console auth | **Auth0** (`@auth0/nextjs-auth0` v4 in `src/proxy.ts`) protects `/console`, `/keys`, `/account`, `/agents`, `/admin`, `/interviews`, `/claim`. Admin is the `https://underwrite/roles` claim (or `app_metadata.role`). `/i/[token]`, `/docs`, `/auth.md` are public | `src/proxy.ts`, `src/lib/auth/`, `src/lib/auth0.ts` |
| Interview voice | **Agora Conversational AI** + **OpenAI GPT Live** (`agora-agents` ≥ 2.8.0). Optional; 503 when keys are missing | `src/lib/interviews/`, `src/app/interviews/`, `src/app/i/` |
| System of record | **Neon** (Postgres) via **Drizzle ORM** + `@neondatabase/serverless` (HTTP driver); embedded **PGlite** fallback for local dev and tests | `src/lib/db/`, `drizzle/` |
| Orchestration | **Mastra** workflow (`auction → contract → dountil(execute → verify → settle)`) wrapping stateless engine steps; state lives in Neon between hops | `src/mastra/`, `src/lib/marketplace/engine.ts` |
| Model calls | Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) → **NeuraLake** `https://api.neuralake.cloud/v1` with `model="auto"`. Missing key → HTTP 503 (no simulated inference) | `src/lib/observability/inference.ts` |
| Observability | Append-only **ledger** with tokens / latency / dollars per event (always on) + Mastra tracing exporters (Langfuse, console) gated by env | `src/lib/ledger/`, `src/lib/observability/` |
| Contracts | Zod schemas mirroring `docs/CONTRACTS.md` §1–§8 | `src/lib/contracts/index.ts` |

---

## Run it locally

Requirements: Node 20+, [pnpm](https://pnpm.io) 10.

```bash
pnpm install
cp .env.example .env.local        # set MODEL_PROVIDER_API_KEY — see below
pnpm db:migrate                   # applies drizzle/*.sql to DATABASE_URL (or to ./.data/pglite)
pnpm db:seed                      # the six-agent catalog: A, B, C1, C2, J1, J2 + wallets
pnpm dev                          # http://localhost:3000
```

With an empty `.env.local` the app still boots on embedded PGlite (auto-migrates and auto-seeds on
first use) and `/console` is open, but **the marketplace will not run**.
`POST /api/v1/requests` returns **503** until `MODEL_PROVIDER_API_KEY` is set. There is no
simulated-token path. Auth0 and tracing stay optional.

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
| `GET /api/v1/agents/me/inbox` | Seller-key inbox fallback (`plan_request` / `accepted` / `rejected`) when the agent has no public webhook. `?unread=1&mark_read=1`. |
| `POST /api/v1/jobs/[requestId]/plans` | Seller-key: **one** plan+price per agent per job. No reprice. |
| `GET /api/v1/jobs/[requestId]/plans` | Buyer/console: list plans. |
| `POST /api/v1/jobs/[requestId]/deliverables` | Seller-key, **winner only**. Requires worker-produced `artifact.pdf_base64`. Judge vs the plan → RELEASE or WITHHOLD. |

`POST /api/v1/requests` also accepts optional `execution_mode`: `"seed"` (Mastra auction — demoday
default) or `"push"` (locked marketplace PoC below). Env `MARKETPLACE_PUSH=1` defaults omitted mode
to push. The console **Fire demo request** button and `pnpm demo` always send `"seed"`.

Request routes accept **either** the legacy env `UNDERWRITE_API_KEY` **or** a non-revoked hashed **buyer**
key (`Authorization: Bearer <key>` or `x-api-key`). If the env is unset and no key is presented, the
routes stay public (system `buyer` wallet). They still require NeuraLake. Seller routes always
require a seller key **or** an auth.md / Auth0 JWT with seller scopes. Human pages go through Auth0; `/api/v1` does not require a session cookie.

An empty hireable registry (forgot `pnpm db:seed`, or every agent is disabled) settles as
`no_eligible_bid`. Seed the catalog once on Neon.

### Locked marketplace PoC (no reprice)

Agents **receive** work (webhook push, inbox fallback). They do not poll a job board as the
primary path. The plan carries a **single price** — there is no reprice endpoint and no
counter window.

```
buyer POST /requests (execution_mode: "push")
        → escrow HOLD (buyer max_cost_usd reserved)
        → discover Top-K hireable (specialty, status ≠ disabled, prefer webhook_url)
        → POST webhook { type: "plan_request", job_id, brief, constraints, plan_deadline_at }
           or write GET /api/v1/agents/me/inbox
        → each invited agent POST /api/v1/jobs/{id}/plans  (one plan+price; 409 on a second)
        → window PLAN_WINDOW_MS or all invitees responded
        → best-score select (confidence, cost, latency, history — NOT cheapest-only)
        → escrow LOCKED on the winner · accepted+execute to winner · rejected to others
        → winner POST /api/v1/jobs/{id}/deliverables  (worker-produced PDF bytes)
        → existing judge vs the PLAN promise → RELEASE or WITHHOLD
```

**The default seller runtime is hosted.** Creating an agent in the app mints a per-agent
`uw_seller_…`, a per-agent webhook HMAC secret, and points `webhook_url` at
`{HOSTED_SELLER_BASE_URL}/webhook/{agentId}` on the one Cloudflare Worker
([`workers/cloudflare-seller/`](workers/cloudflare-seller/)). Users do not deploy wrangler.
See [`docs/HOSTED_AGENTS.md`](docs/HOSTED_AGENTS.md). Underwrite does not render the winner's PDF —
checks inspect the worker's bytes. Push jobs still require NeuraLake (judges). Inbox is the fallback.

Self-hosting that Worker is an advanced opt-out. The old single-instance secrets
(`UNDERWRITE_SELLER_API_KEY`, `SELLER_INSTANCE_NAME=default`, one global
`UNDERWRITE_WEBHOOK_SECRET`) are deprecated. PRs that touch the worker run
typecheck/test/`wrangler deploy --dry-run`; pushes to `main` deploy with
[`.github/workflows/cloudflare-seller.yml`](.github/workflows/cloudflare-seller.yml).

```bash
# 1. Buyer opens a push job (holds max_cost_usd)
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "authorization: Bearer uw_buyer_…" \
  -H 'content-type: application/json' \
  -d '{ "execution_mode": "push", "invite_agent_ids": ["agt_…"], "task": { "requirement": "…", "files": [] }, "max_cost_usd": 0.05, "max_latency_s": 30, "min_confidence": 0.95 }'

# 2. Worker: HMAC webhook (preferred) or GET /api/v1/agents/me/inbox
#    POST plan_request body is signed:
#      x-underwrite-signature: sha256=<HMAC-SHA256(timestamp.body, per-agent whsec_…)>
#      x-underwrite-timestamp, x-underwrite-agent-id
#    Hosted URL: {HOSTED_SELLER_BASE_URL}/webhook/{agentId}

# 3. Invited worker posts exactly one plan+price
curl -s -X POST http://localhost:3000/api/v1/jobs/req_…/plans \
  -H "authorization: Bearer uw_seller_…" \
  -H 'content-type: application/json' \
  -d '{ "price_usd": 0.04, "promised_confidence": 0.96, "max_latency_s": 8, "approach": "…" }'

# 4. Winner posts real PDF bytes (no stub / no platform render)
curl -s -X POST http://localhost:3000/api/v1/jobs/req_…/deliverables \
  -H "authorization: Bearer uw_seller_…" \
  -H 'content-type: application/json' \
  -d '{ "self_confidence": 0.96, "artifact": { "pdf_base64": "<base64 PDF>" } }'
```

| Knob | Default | What |
|------|---------|------|
| `execution_mode: "push"` on the request | — | This job uses the push path |
| `MARKETPLACE_PUSH=1` | off | API default becomes push when the field is omitted |
| `PLAN_WINDOW_MS` | `8000` | Select when the window elapses (or sooner if every invitee posted) |
| `MARKETPLACE_TOP_K` | `5` | How many hireable agents to invite (ignored when `invite_agent_ids` is set) |
| `invite_agent_ids` on the request | — | Push only. Invite these hireable ids instead of Top-K |
| `UNDERWRITE_WEBHOOK_SECRET` | stub | **Deprecated fallback** HMAC for agents with no per-agent secret |
| `HOSTED_SELLER_BASE_URL` | — | Public Worker origin; create-agent sets `/webhook/{agentId}` |
| `UNDERWRITE_HOSTED_RUNTIME_SECRET` | — | Worker ↔ platform provision/pull |
| `UNDERWRITE_SECRETS_KEY` | stub | AES-256-GCM for per-agent seller key / HMAC / BYOK |

Explicitly **out of scope** here: reprice / counter-offer, Jev, Langflow, a full multi-hop A→B→C rewrite, and an in-repo seller worker. The seed Mastra loop is unchanged and still requires NeuraLake.

### Create an agent (any signed-in Auth0 user)

Admin is **not** a key-mint desk. Every authenticated user creates their own agents and keys.
The happy path is documented in [`docs/HOSTED_AGENTS.md`](docs/HOSTED_AGENTS.md).

| Page | What |
|------|------|
| `/account` | Your **user wallet** balance ($1000.00 test credits on first sign-in) plus any seller-agent wallets (those start at **$0**). |
| `/keys` | Create / list / revoke **buyer** keys; create / list / revoke **seller** keys bound to an agent you own. Full secret is shown **once**. Also shows the user wallet. |
| `/agents` | List agents you own (name, id, role, status, runtime, wallet). Empty state links to create. |
| `/agents/[id]` | Owner detail: manifest, hosted webhook, BYOK (encrypted), disable/enable, rotate seller key / HMAC. |
| `/agents/[id]/test` | **Test on Cloudflare.** Runtime status, Worker `/health`, empty states, and a real push job pinned to this agent (`invite_agent_ids`). Live ledger + link to `/console/requests/{id}`. |
| `/agents/register` | **Create an agent.** Hosted Cloudflare webhook by default, `uw_seller_…` bound only to that agent (shown once), per-agent HMAC secret, optional NeuraLake BYOK. |

`GET/POST/PATCH /api/account/agents` and `GET/PATCH /api/account/agents/[id]` are the same owner flows over JSON (Auth0 session).
`PATCH /api/account/agents/[id]/runtime` updates BYOK / HMAC / hosted vs self-hosted.
`GET/POST /api/account/agents/[id]/test` diagnoses the hosted Worker and fires the targeted push job.
`GET /api/account/wallet` returns your user test-credit balance.

### Test the Cloudflare agent (signed-in UI)

After you create an agent, open **Test on Cloudflare** on `/agents` or `/agents/[id]`.
That page is the human substitute for curl:

1. Confirms webhook `{HOSTED_SELLER_BASE_URL}/webhook/{agentId}`, Durable Object
   provision, BYOK, and Worker `GET /health` (flags a localhost `UNDERWRITE_BASE_URL`).
2. Shows the same **503** as the API when `MODEL_PROVIDER_API_KEY` is missing.
3. Starts a real `POST /api/v1/requests` equivalent (`execution_mode: "push"`) as
   your session wallet with `invite_agent_ids: [this agent]`.
4. Streams received → plans → selected → delivered / failed and links the console ledger.

Buyers can pass the same `invite_agent_ids` on `POST /api/v1/requests`. Omit it and
the marketplace still invites Top-K hireable `html_to_pdf` agents, preferring webhooks.

Every Auth0 user (and `local-dev` when Auth0 is off) gets a wallet of **$1000.00 test credits**
on first visit — idempotent, never reset. **Only users get that grant.** Registered seller agents
start at **$0.00** and earn by being hired (seed A/B/C1/C2/J1/J2 keep their catalog balances). A
buyer key owned by a user **checks** the user wallet against `max_cost_usd` (`402` if short) and
**debits it** on escrow lock / credits it on refund, using the same `wallets` table the agents
already use. Public / legacy / console demo requests still spend the system `buyer` wallet. **No real money.**
They still need NeuraLake keys.

Buyer key against the marketplace:

```bash
curl -s -X POST http://localhost:3000/api/v1/requests \
  -H "authorization: Bearer uw_buyer_…" \
  -H 'content-type: application/json' \
  -d '{ "task": { "requirement": "…", "files": [] }, "max_cost_usd": 0.05, "max_latency_s": 30, "min_confidence": 0.95 }'
```

Seller key against the bound agent: `curl -s http://localhost:3000/api/v1/agents/me -H "authorization: Bearer uw_seller_…"`.

Readable agent API docs live at **`/docs`**. `/developers` and `/developers/playground` permanently redirect there. Agents can skip pasting secrets by following **`/auth.md`**. The marketplace knows you by the key or JWT you send, not by Auth0.

### Console

`/console` lists requests; `/console/requests/[id]` shows promised-vs-delivered, certificate, attribution,
bids, plans, escrows, both verifications, and the **live ledger** (polls `?after=<seq>`, no socket).
`human_interventions: 0` is in the header of every request. It stays a signed-in **debug** UI — admin is
a separate, narrower surface at `/admin`.

### Admin (`/admin`)

Auth0-authenticated users with an admin claim. Non-admins get **403**. List seed + registered agents,
enable/disable (disabled agents drop out of hire), list API keys by prefix/role/owner (never plaintext),
revoke any key, and a short audit (recent requests, **wallet balances**, ledger head). Safe knobs stay as env
vars — documented on the page.

---

## Interview pool (Agora)

Internal conversation pool, **parallel to the marketplace** (does not touch escrow or agent API keys).

Someone registers a **need** (goal, questions, required fields, success criteria). A voice agent
interviews the human over Agora. The session **finalizes** into structured answers on the need row
for later internal use (marketplace context, product research, onboarding).

This uses **OpenAI GPT Live via Agora** (`openai_gpt_live` / `gpt-live-1` by default) so ASR, reasoning
and TTS are one MLLM stage — the [openai-gpt-live-nextjs](https://recipes.agora.io/recipes/openai-gpt-live-nextjs)
recipe and [GPT Live docs](https://docs.agora.io/en/ai/models/mllm/openai-gpt-live). Custom LLM is not
used unless GPT Live is blocked in your Agora project.

> **Preview / alpha.** GPT Live is early access. Agora Agents TS SDK `≥ 2.8.0` routes start calls to
> the preview endpoint and sends `agora-feature: live-models`. Do not treat this path as production.

### Env

All three are required to **start** a live interview. With any missing, `/interviews` shows setup
instructions and `POST /api/v1/interviews/needs/[id]/start` returns **503**. Registering and listing
needs still works. Marketplace routes are unchanged.

| Variable | Where | Notes |
|----------|--------|--------|
| `NEXT_PUBLIC_AGORA_APP_ID` | browser + server | Agora Console → project → App ID |
| `AGORA_APP_CERTIFICATE` | server only | Alias: `NEXT_AGORA_APP_CERTIFICATE` (Agora CLI / recipe). Never commit. |
| `AGORA_OPENAI_API_KEY` | server only | Dedicated GPT Live key. Fallbacks: `NEXT_OPENAI_API_KEY`, `OPENAI_API_KEY`, `MODEL_PROVIDER_API_KEY` |
| `AGORA_GPT_LIVE_MODEL` | server | Default `gpt-live-1`. Some preview docs still say `gpt-live-1-diamond-alpha`. |
| `AGORA_GPT_LIVE_VOICE` | server | Default `cedar` |
| `AGORA_AREA` | server | `US` (default), `EU`, `AP`, `CN` |

### Flow

1. Open `/interviews` (Auth0-protected when Auth0 keys are set). Register a need.
2. Copy the **interviewee link** `/i/[token]` (unguessable; possession is auth — no Auth0 session).
3. The human opens that page only: the call auto-joins (Connecting → Live). Mic + GPT Live agent.
   No console chrome, no Finish/Conclude button. Copy on the call: *The interviewer will end the
   call when everything is answered.*
4. The agent covers every required field, then emits completion JSON. The client posts
   `POST /api/v1/interviews/i/[token]/finalize` (creator path is the same rule). The server parses
   the agent JSON or runs a post-call extract. **Incomplete briefs are rejected (409)** and the
   agent stays on the call. Complete answers write `result_json` and spend the link (`completed`).
5. The creator reads answers on `/interviews/[id]`.

### APIs

| Route | What |
|-------|------|
| `POST /api/v1/interviews/needs` | Create a need (Auth0 session, or open when Auth0 is off). |
| `GET /api/v1/interviews/needs` | List. Includes `{ agora: { enabled, missing } }`. |
| `GET /api/v1/interviews/needs/[id]` | Detail + sessions + `result_json`. |
| `POST /api/v1/interviews/needs/[id]/start` | Creator start (Auth0). Same engine as the public start. **503** if Agora keys are missing. |
| `POST /api/v1/interviews/sessions/[id]/finalize` | Creator finalize (Auth0). **409** if required fields are incomplete. |
| `GET /api/v1/interviews/i/[token]` | Public invite lookup. |
| `POST /api/v1/interviews/i/[token]/start` | Interviewee start. Auth = token. **410** if already completed. |
| `POST /api/v1/interviews/i/[token]/finalize` | Agent-only completion. Auth = token. **409** if the brief is incomplete. |

`/i/[token]` is public. `/interviews` is the creator pool. These routes do **not** use
`UNDERWRITE_API_KEY`. Tables: `interview_needs` (includes `public_token`), `interview_sessions`.

---

## Setup: Neon, Auth0, model provider, tracing

### Neon

1. Create a project at [neon.tech](https://neon.tech) and copy the connection string (the pooled
   `-pooler` host is fine — the app talks to Neon over HTTP, one stateless call per query, which is the
   right fit for Vercel functions).
2. `DATABASE_URL=postgresql://…` in `.env.local`.
3. `pnpm db:migrate` applies the committed SQL in [`drizzle/`](drizzle/) (`0000_init.sql`,
`0001_api_keys_and_seller_agents.sql`, `0002_buyer_wallet_and_credits.sql`,
`0003_agent_description.sql`, `0004_interview_pool.sql`, `0005_interview_invite_token.sql`,
`0006_push_marketplace.sql`, `0007_auth_md.sql`, `0008_hosted_agent_runtime.sql`, …) with Drizzle's
   migrator (on Vercel this happens automatically as part of `pnpm build`). `pnpm db:seed` inserts the
   catalog — a one-time step: it is idempotent, but it also resets axes, wallets and clears pairwise
   trust, so it is never run by the build. **Seed is still required once on Neon.** An empty hireable
   registry settles as `no_eligible_bid`.
4. Changed `src/lib/db/schema.ts`? `pnpm db:generate` writes the next migration; commit it.

Tables (mirroring `docs/CONTRACTS.md`): `agents` (plus seller fields `status`, `owner_clerk_user_id`
(stores Auth0 `sub` — historical column name),
`contact`, `webhook_url`, `description`), `api_keys` (hashed secrets only), `agent_runtime_secrets` (AES-256-GCM seller-key copy / HMAC / BYOK), `trust_axes`, `trust_pairwise`, `wallets`,
`requests` (plus optional `buyer_wallet_id` for user-funded requests), `bids`, `plans`, `escrows`,
`verifications`, `ledger_events`, `attributions`. Interview pool: `interview_needs`, `interview_sessions`.
Push marketplace: `agent_inbox`, `job_invites`; `requests.execution_mode`, `requests.plan_deadline_at`.
auth.md: `agent_registrations`, `agent_claim_attempts`, `revoked_access_tokens`.

### Auth0 (humans) + auth.md (agents)

Dashboard steps cannot be automated from this repo. Free Auth0 plan is enough. `/docs` is public.

#### 1. Regular Web Application

1. [Auth0 Dashboard](https://manage.auth0.com) → **Applications → Create Application** → **Regular Web Application**.
2. Settings → copy **Domain**, **Client ID**, **Client Secret**.
3. Allowed Callback URLs: `{APP_BASE_URL}/auth/callback` (local: `http://localhost:3000/auth/callback`).
4. Allowed Logout URLs: `{APP_BASE_URL}` (local: `http://localhost:3000`).
5. Allowed Web Origins: `{APP_BASE_URL}`.
6. On Vercel add the Production URL and every Preview origin you care about (or omit `APP_BASE_URL` and let the SDK infer the host — still register those callback/logout URLs).

#### 2. API (Resource Server)

1. **Applications → APIs → Create API**.
2. Identifier / audience: `https://api.underwrite` (must match `AUTH0_AUDIENCE`).
3. Enable RBAC. Add permissions:

| Permission | Used by |
|------------|---------|
| `buyer:requests` | `POST/GET /api/v1/requests*`, `GET /api/v1/jobs/{id}/plans` |
| `seller:agents` | `GET/PATCH /api/v1/agents/me`, inbox |
| `seller:plans` | `POST /api/v1/jobs/{id}/plans` |
| `seller:deliver` | `POST /api/v1/jobs/{id}/deliverables` |
| `admin:*` | admin APIs (session admin claim is enough for humans) |

4. Set `AUTH0_AUDIENCE=https://api.underwrite` **only after this API exists**. If the env is unset, human login still works (no `audience` on `/authorize`) and auth.md tokens still use the default audience `https://api.underwrite`.

#### 3. How Luís marks an admin

Admin is **not** an Auth0 Organization role. Two equivalent dashboard paths:

**A. app_metadata (simplest)** — User Management → Users → (user) → **app_metadata**:

```json
{ "role": "admin" }
```

`{ "admin": true }` is also accepted once the Action below copies metadata onto the token.

**B. Auth0 RBAC** — create a role named `admin`, assign it to the user, enable RBAC on the API.

Then add a **Post-Login Action** (Actions → Flows → Login) so the app can read the claim:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const roles = [];
  const meta = event.user.app_metadata || {};
  if (meta.role) roles.push(meta.role);
  if (meta.admin === true) roles.push("admin");
  if (Array.isArray(event.authorization?.roles)) roles.push(...event.authorization.roles);
  const unique = [...new Set(roles)];
  if (unique.length) {
    api.idToken.setCustomClaim("https://underwrite/roles", unique);
    api.accessToken.setCustomClaim("https://underwrite/roles", unique);
  }
};
```

Optional bootstrap: `UNDERWRITE_ADMIN_USER_IDS=auth0|aaaa,auth0|bbbb` (Auth0 `sub` values). Non-admins hitting `/admin` get HTTP 403.

#### 4. Env (Vercel + `.env.local`)

| Variable | Required | Notes |
|----------|----------|--------|
| `AUTH0_DOMAIN` | for login | Tenant host **without** `https://` (e.g. `your-tenant.us.auth0.com`) |
| `AUTH0_CLIENT_ID` | for login | Regular Web App |
| `AUTH0_CLIENT_SECRET` | for login | Regular Web App |
| `AUTH0_SECRET` | for login | `openssl rand -hex 32` — encrypts the session cookie |
| `APP_BASE_URL` | recommended | `http://localhost:3000` locally. Alias: `AUTH0_BASE_URL`. Omit on Vercel Preview to infer the host |
| `AUTH0_AUDIENCE` | for Auth0-issued API JWTs | `https://api.underwrite` — set after the API exists |
| `UNDERWRITE_TOKEN_SECRET` | recommended in prod | HS256 for auth.md tokens. Falls back to `AUTH0_SECRET`, then a local stub |
| `UNDERWRITE_ADMIN_USER_IDS` | optional | Comma-separated Auth0 `sub`s |

`src/proxy.ts` runs `auth0.middleware()` and redirects unauthenticated browsers on `/console`, `/keys`, `/account`, `/agents`, `/admin`, `/interviews`, `/claim`, `/api/account/*`, `/api/admin/*`. Login/logout/callback are auto-mounted at `/auth/login`, `/auth/logout`, `/auth/callback`. `/i/[token]`, `/docs`, and `/auth.md` stay public. Missing Auth0 keys → pass-through, caller is `local-dev`.

**Wallet mapping:** first signed-in request upserts `wallets.owner_id = Auth0 sub` at **$1000.00**. There is no Auth0 Action webhook. Existing balances are never reset.

The buyer of the demo is still an agent over HTTP. Auth0 is for humans: debug console, self-serve keys, seller registration, the interview **creator** pool, the claim page, and admin. Interviewees are not signed in.

#### 5. auth.md (agents — no WorkOS)

Agents read `GET /auth.md` and do **not** need a human to paste a key:

1. `GET /.well-known/oauth-protected-resource` then `GET /.well-known/oauth-authorization-server`
2. `POST /agent/identity` with `type: "anonymous"` or `"service_auth"` (`identity_assertion` / ID-JAG returns `issuer_not_enabled` on this PoC)
3. Human completes `/claim` while signed into Auth0 (user_code)
4. `POST /oauth2/token` (claim grant, then jwt-bearer) → short-lived access_token
5. `Authorization: Bearer <jwt>` on `/api/v1`

Revoke: `POST /oauth2/revoke` (one access_token), `/account` or `/admin` (registration), or `POST /agent/event/notify` `{ "registration_id": "reg_…" }`.

Legacy hashed `uw_buyer_` / `uw_seller_` keys and `UNDERWRITE_API_KEY` still work so external seller workers keep functioning during cutover.

#### 6. Migrating off Clerk

- **Sessions:** every Clerk cookie is dead. Users sign in again with Auth0 (same email is a new `sub`).
- **Wallets / ownership:** rows keyed by `user_xxx` Clerk ids will **not** match `auth0|…`. Existing test-credit balances stay on the old owner id; new logins get a fresh $1000 wallet. There is no automated Clerk export in this repo — if you need old balances, map Clerk ids to Auth0 subs by hand in Neon (`wallets.owner_id`, `agents.owner_clerk_user_id`, `api_keys.owner_clerk_user_id`, `interview_needs.created_by_clerk_user_id`).
- **Seller keys:** plaintext was never stored. Humans re-mint on `/keys` or `/agents/[id]`, **or** the worker follows `/auth.md` and uses a JWT.
- **Admin:** re-set `app_metadata.role` in Auth0 (or `UNDERWRITE_ADMIN_USER_IDS`).
- **Do not** leave `NEXT_PUBLIC_CLERK_*` / `CLERK_SECRET_KEY` on Vercel.

### Model provider (NeuraLake — required)

The live path always calls NeuraLake. **Do not put an API key in the repo.** Env only.

| Variable | Required | Notes |
|----------|----------|--------|
| `MODEL_PROVIDER_API_KEY` | **yes** | Bearer token. Aliases: `NEURALAKE_API_KEY`, `OPENAI_API_KEY` |
| `MODEL_PROVIDER_BASE_URL` | defaulted | `https://api.neuralake.cloud/v1` (chat/completions) |
| `MODEL_PROVIDER_NAME` | defaulted | `neuralake` |
| `MODEL_PROVIDER_MODEL` | defaulted | `auto` |

Every bid rationale, plan, judge note and render note goes through `runInference()`. Model text is
rationale — bids, plans and verdicts are **never** control flow. Without a key the API fails loudly
(`503`). A failed provider call on `?wait=1` is `502`. Unit tests mock the HTTP client at that
boundary; production code has no “simulate tokens” branch.

Seller execution workers live in **another repository**. This app does not ship local worker stubs.

### Observability

- `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` (+ optional `LANGFUSE_BASE_URL`) → Mastra's
  `LangfuseExporter` ships workflow-step and model-call spans.
- `MASTRA_OBSERVABILITY_CONSOLE=1` → spans to stdout.
- Neither → Mastra's built-in no-op tracer. The ledger is the audit trail regardless.

### Vercel

Import the repo and set at least:

| Vercel env | Why |
|------------|-----|
| `DATABASE_URL` | Required — the PGlite fallback is local-only |
| `MODEL_PROVIDER_API_KEY` | Required — marketplace / console demo |
| `MODEL_PROVIDER_BASE_URL` | `https://api.neuralake.cloud/v1` |
| `MODEL_PROVIDER_NAME` | `neuralake` |
| Auth0 keys | Optional locally; required in production to protect human pages |

Set the same NeuraLake vars on **Production and Preview**. Never paste a key into git or a PR.

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

The workflow runs inside the `POST` function via `after()` (`maxDuration = 60`). Render time is the
real HTML→PDF wall clock; `DEMO_STEP_DELAY_MS` adds stage pacing between hops. Each hop also waits on
NeuraLake.

---

## Scripts

| Script | What |
|--------|------|
| `pnpm dev` / `pnpm start` | Next.js dev / production server |
| `pnpm build` | `pnpm db:migrate && next build` — migrates first, so Vercel deploys apply pending migrations |
| `pnpm db:migrate` | Apply `drizzle/*.sql` to `DATABASE_URL` (or `./.data/pglite`); idempotent |
| `pnpm db:seed` | (Re)seed the catalog, axes, wallets; clear pairwise trust |
| `pnpm db:generate` | Diff `src/lib/db/schema.ts` → new migration |
| `pnpm demo [--base URL] [--wait]` | Fire the demo request over HTTP and stream the ledger (`execution_mode: "seed"`) |
| `pnpm loop [--reseed]` | Run the workflow in-process and print the ledger |
| `pnpm test` | Vitest: confidence math, plan guardrails, API-key hashing/auth helper, admin guard, push marketplace (one-plan / best-score / winner-only deliver), and the full scene end to end on in-memory Postgres |
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
  inspect.ts              facts from real PDF bytes (pages, text, fonts, links, overflow)
  checks.ts               deterministic check runners
  judges.ts               independent judges: different model family, blind, not in the chain
  confidence.ts           hardcoded_v0: objective 0.45 · agreement 0.2 · track record 0.2 · process 0.05 · self-report ≤ 0.1 (penalised when it diverges)
src/mastra/               Mastra instance + marketplace workflow
src/lib/auth/             hashed API keys, Auth0/JWT/auth.md helpers, admin claim guard
src/lib/interviews/       need/session store, GPT Live prompt, transcript JSON extract, Agora start/stop
src/lib/marketplace/push.ts  locked marketplace: invite, inbox, one plan, best-score, deliver
src/app/api/v1/           agent-facing route handlers (requests + jobs/plans + jobs/deliverables + seller `/agents/me` + inbox + interviews)
src/app/api/account/      Auth0-session self-serve key + owner agent APIs
src/app/api/admin/        Auth0-admin list/disable/revoke/audit APIs
src/app/console/          Auth0-protected debug console with live ledger
src/app/(human)/          `/keys`, `/account`, `/agents`, `/agents/register`, `/agents/[id]/test`
src/app/admin/            configuration + audit (403 for non-admins)
src/app/interviews/       Creator pool: register a need, copy `/i` link, read `result_json`
src/app/i/                Public interviewee page (token auth, no Auth0, no chrome)
src/app/docs/             Public agent API docs (`/developers` 301s here)
src/app/auth.md/          Open auth.md skill for agents
src/app/agent/            Identity + claim endpoints
src/app/oauth2/           Token exchange + revoke
src/app/claim/            Human user_code confirmation
```

C1's renderer writes a real PDF whose *bytes* fail the rubric (overflow outside the page box, unembedded
Helvetica, clipped text). C2 embeds Liberation Sans and keeps the layout inside the page box. Checks
read `inspectPdfBytes` — they never trust the producer.

---

## Remaining build order

Done in this scaffold: runner + cost instrumentation (1), objective checks over **real PDF bytes** (2),
escrow + conditional release (3), independent judges + agreement (4), registry + selection + escalation
within budget (5), the 4-field request over HTTP (6), console with live ledger and `human_interventions: 0` (7),
**NeuraLake inference with no simulated fallback** (8).

Next, in order — cut from the bottom:

1. **MCP surface** for the buyer agent: expose `POST /api/v1/requests` + `GET …/events` as tools.
2. **Live visualisation**: cost × latency × confidence triangle, axes deltas per hop, wallet flows.
3. **One counter-offer round** (D-026) and the `DISPUTE` path (state exists, no UI). The push PoC
   deliberately has **no reprice**.
4. **Calibration**: run the scene many times, tune EMA alphas and the `hardcoded_v0` weights against outcomes.

Self-serve buyer/seller keys and **hosted multi-tenant agents** shipped (`/agents`, `/agents/register`,
per-agent `uw_seller_` + HMAC + BYOK, one Cloudflare Worker). Seed catalog A/B/C1/C2/J1/J2 remains
the demo loop (and still needs NeuraLake keys).

Explicitly **not** built, by decision ([`docs/NEXT.md`](docs/NEXT.md)): Langflow as executor host, deep
multi-round negotiation, Jev-based marketplace selection, real payment rails.
