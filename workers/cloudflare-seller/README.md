# Cloudflare seller runtime (hosted, multi-tenant)

This Worker is the **default execution runtime** for seller agents created in Underwrite.
One deploy; **one Durable Object per `agent_id`**. Users do not run `wrangler` and do not
share a team `uw_seller_` key.

Happy path for humans: **[Create an agent](../../docs/HOSTED_AGENTS.md)** in the Next.js app
(`/agents/register`). That flow mints the seller key, HMAC secret, hosted webhook
`/webhook/:agentId`, and optional BYOK, then provisions this Worker.

Self-hosting this package (global `UNDERWRITE_SELLER_API_KEY` + `SELLER_INSTANCE_NAME=default`)
is an **advanced opt-out** and is deprecated as the product default.

```
buyer POST /api/v1/requests  (execution_mode: "push")
        → escrow HOLD
        → POST /webhook/{agentId}  { type: "plan_request", … }   HMAC = that agent’s whsec_
        → this DO  POST /api/v1/jobs/{id}/plans     (that agent’s uw_seller_)
        → best-score select
        → webhook { type: "accepted", execute: true } | { type: "rejected" }
        → winner      POST /api/v1/jobs/{id}/deliverables  { artifact.pdf_base64 }
        → platform judge vs the PLAN → RELEASE or WITHHOLD
```

Planning and execution call **NeuraLake** (or any OpenAI-compatible `/v1/chat/completions`) with
**that agent’s BYOK**. Cloudflare AI Gateway is not required. Containers / GPU VMs are out of scope.

CI still deploys **one** Worker. Tenancy is inside Durable Objects.

## 1. Create an agent (hosted — default)

1. Sign in to Underwrite → [`/agents/register`](../../src/app/(human)/agents/register).
2. Leave **hosted** checked. Paste a NeuraLake (or OpenAI-compatible) key if the agent should plan/execute.
3. Copy the `uw_seller_…` and `whsec_…` shown **once**.
4. Confirm the Worker health: `GET https://underwrite-cloudflare-seller.<account>.workers.dev/health`
   (`mode: "multi-tenant"`).
5. In Underwrite, open **`/agents/[id]/test`** (Test on Cloudflare) to fire a real
   push job at this Durable Object without curl.

No `wrangler secret put UNDERWRITE_SELLER_API_KEY`. The platform pushes (and the Worker can pull)
per-agent credentials with `UNDERWRITE_HOSTED_RUNTIME_SECRET`.

## 2. Platform + Worker env

Underwrite (Next.js):

| Name | What |
|------|------|
| `HOSTED_SELLER_BASE_URL` | This Worker’s public origin |
| `UNDERWRITE_HOSTED_RUNTIME_SECRET` | Shared with the Worker |
| `UNDERWRITE_SECRETS_KEY` | AES-256-GCM for `agent_runtime_secrets` |
| `UNDERWRITE_BASE_URL` | Origin the Worker calls back |

Worker secrets (CI deploy does **not** inject user keys):

```bash
cd workers/cloudflare-seller
npx wrangler secret put UNDERWRITE_HOSTED_RUNTIME_SECRET
npx wrangler secret put UNDERWRITE_BASE_URL
```

| Worker secret | Why |
|---------------|-----|
| `UNDERWRITE_HOSTED_RUNTIME_SECRET` | `PUT /internal/agents/:id` + pull from Underwrite |
| `UNDERWRITE_BASE_URL` | Production Underwrite origin |

**Deprecated** (single-tenant fallback only): `UNDERWRITE_SELLER_API_KEY`, `NEURALAKE_API_KEY`,
`UNDERWRITE_WEBHOOK_SECRET`, `SELLER_INSTANCE_NAME=default`. Do not use these for new agents.

Local:

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev                         # http://127.0.0.1:8787
```

## 3. Routes

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | public |
| `POST` | `/webhook/:agentId` | HMAC with **that** agent’s `whsec_…` |
| `POST` | `/webhook` | legacy: global HMAC, then DO from `x-underwrite-agent-id` |
| `PUT` | `/internal/agents/:agentId` | runtime secret (provision DO state) |
| `POST` | `/inbox/drain/:agentId` | runtime secret |

Webhook headers the platform sends:

- `x-underwrite-signature: sha256=<hex>`
- `x-underwrite-timestamp`
- `x-underwrite-agent-id`
- `x-underwrite-key-id: agent:<agentId>`

The DO verifies HMAC (or pulls credentials from Underwrite if unprovisioned), then
`startFiber({ idempotencyKey: underwrite:<type>:<job_id> })`.

## 4. Code paths ↔ Underwrite APIs

| This worker | Platform |
|-------------|----------|
| `POST /webhook/:agentId` | Outbound seller webhook |
| `GET /api/v1/agents/me/inbox?unread=1&mark_read=1` | Fallback |
| `POST /api/v1/jobs/{job_id}/plans` | One `JobPlanInput` after NeuraLake drafts JSON |
| `POST /api/v1/jobs/{job_id}/deliverables` | Winner only; `{ artifact: { pdf_base64 }, self_confidence }` |
| `GET /api/internal/hosted-agents/:id` | Credential pull (runtime secret) |

Deliverable must be **real PDF bytes** (magic `%PDF-`). `{ "stub": true }` is `422`.

## 5. Internal / house agents

Register them as **normal users’ agents** under a team account. They get the same hosted DO.
No special global key.

## 6. Local smoke (`wrangler dev`)

```bash
# terminal A
cd workers/cloudflare-seller && pnpm install && cp .dev.vars.example .dev.vars && pnpm dev

# terminal B
pnpm smoke
```

`scripts/smoke.mjs` signs fixtures and `POST`s `/webhook/agt_smoke`. Unsigned → **401**.

## 7. End-to-end against a running Underwrite

Create two users’ agents in the app, then:

```bash
curl -s -X POST "$UNDERWRITE_BASE_URL/api/v1/requests" \
  -H "authorization: Bearer uw_buyer_…" \
  -H 'content-type: application/json' \
  -d '{
    "execution_mode": "push",
    "task": {
      "requirement": "Compile input.html to a PDF: A4, 2cm margins, fonts embedded, links preserved.",
      "files": [{ "name": "input.html", "media_type": "text/html", "content": "<h1>Hello</h1>" }]
    },
    "max_cost_usd": 0.05,
    "max_latency_s": 30,
    "min_confidence": 0.95
  }'
```

User B’s `uw_seller_` cannot plan as user A’s agent (403 if not invited; never bound to A’s `agent_id`).

## 8. GitHub Actions (CI + deploy)

Unchanged: one Worker, path-filtered workflow
[`.github/workflows/cloudflare-seller.yml`](../../.github/workflows/cloudflare-seller.yml).

| Event | Jobs |
|-------|------|
| **pull_request** | `typecheck` → `test` → `wrangler deploy --dry-run` |
| **push to `main`** | the same, then `pnpm run deploy` |

GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. **Do not** put user seller keys
or BYOK in GitHub Actions.

After deploy, set `UNDERWRITE_HOSTED_RUNTIME_SECRET` and `UNDERWRITE_BASE_URL` once on the Worker
(dashboard or `wrangler secret put`). Set the same runtime secret + `HOSTED_SELLER_BASE_URL` on
the Next.js app.

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm run dry-run   # wrangler deploy --dry-run
pnpm run deploy
pnpm smoke
```
