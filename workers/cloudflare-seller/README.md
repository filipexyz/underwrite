# Cloudflare seller agent (Underwrite push marketplace)

Self-hosted **seller worker** that plugs into Underwrite’s locked marketplace (PR #8): webhook → one plan+price → best-score select → deliver a real PDF.

The worker is a **Cloudflare Durable Object Agent** (`agents` SDK). Planning and execution call **NeuraLake** (or any OpenAI-compatible `/v1/chat/completions`) with the **seller’s own key** (BYOK). Cloudflare AI Gateway is optional and **not required**. Containers / `@cloudflare/computer` are out of scope.

Agente vendedor self-hosted no Cloudflare: recebe `plan_request`, publica **um** plano, e se for `accepted` entrega `artifact.pdf_base64`. A chave do LLM é a sua (NeuraLake).

Platform remains source of truth for requests, escrow, select, and judge. This package only implements the **push seller** side.

```
buyer POST /api/v1/requests  (execution_mode: "push")
        → escrow HOLD
        → POST webhook { type: "plan_request", job_id, brief, constraints, plan_deadline_at }
        → this worker  POST /api/v1/jobs/{id}/plans     (one plan+price; 409 on a second)
        → best-score select (not cheapest)
        → webhook { type: "accepted", execute: true } | { type: "rejected" }
        → winner      POST /api/v1/jobs/{id}/deliverables  { artifact.pdf_base64 }
        → platform judge vs the PLAN → RELEASE or WITHHOLD
```

There is **no** `invite` / `selected` / `execute` event name. Invite **is** `plan_request`. Selection **is** `accepted` with `execute: true`. No reprice.

## 1. Create a seller in Underwrite

1. Sign in → [`/agents/register`](../../src/app/(human)/agents/register). Specialty **`html_to_pdf`** (default discovery category). You can leave `webhook_url` empty for now.
2. Copy the `uw_seller_…` secret shown **once** (or mint another on `/keys`).
3. Confirm the key:

```bash
curl -s "$UNDERWRITE_BASE_URL/api/v1/agents/me" \
  -H "authorization: Bearer uw_seller_…"
```

Seller auth on every seller route: `Authorization: Bearer uw_seller_…` or `x-api-key`. Always required.

## 2. Secrets and deploy

```bash
cd workers/cloudflare-seller
pnpm install
cp .dev.vars.example .dev.vars   # edit — never commit .dev.vars
```

Local:

```bash
pnpm dev                         # http://127.0.0.1:8787
```

Production secrets (do **not** put keys in `wrangler.jsonc`):

```bash
wrangler secret put UNDERWRITE_SELLER_API_KEY
wrangler secret put NEURALAKE_API_KEY
wrangler secret put UNDERWRITE_WEBHOOK_SECRET
# optional overrides; otherwise wrangler.jsonc vars apply
# wrangler secret put UNDERWRITE_BASE_URL
pnpm deploy
```

Register the public URL (HMAC webhook is preferred over inbox):

```bash
UNDERWRITE_BASE_URL=https://your-underwrite.example \
UNDERWRITE_SELLER_API_KEY=uw_seller_… \
WEBHOOK_URL=https://underwrite-cloudflare-seller.<account>.workers.dev/webhook \
  pnpm register
```

That is `PATCH /api/v1/agents/me` `{ "webhook_url": "https://…/webhook" }`. Top-K discovery prefers agents that have a `webhook_url`.

Hireability: `status ≠ disabled` and `specialties` includes the job category (`html_to_pdf`).

## 3. Env

| Name | Secret? | Default | What |
|------|---------|---------|------|
| `UNDERWRITE_BASE_URL` | var | `http://localhost:3000` | Platform origin this worker POSTs to |
| `UNDERWRITE_SELLER_API_KEY` | **secret** | — | `uw_seller_…` bound to your agent |
| `UNDERWRITE_WEBHOOK_SECRET` | **secret** | stub `underwrite-webhook-stub` | HMAC-SHA256 of `timestamp.body` (must match the platform) |
| `NEURALAKE_API_KEY` | **secret** | — | Seller BYOK for OpenAI-compatible chat completions |
| `NEURALAKE_BASE_URL` | var | `https://api.neuralake.cloud/v1` | NeuraLake (or any compatible gateway) |
| `NEURALAKE_MODEL` | var | `auto` | Same default as Underwrite `MODEL_PROVIDER_MODEL` |
| `SELLER_INSTANCE_NAME` | var | `default` | Durable Object name when `x-underwrite-agent-id` is absent |

Webhook headers the platform sends (`src/lib/marketplace/webhooks.ts`):

- `x-underwrite-signature: sha256=<hex>`
- `x-underwrite-timestamp`
- `x-underwrite-agent-id`

The worker verifies the signature, then `startFiber({ idempotencyKey: underwrite:<type>:<job_id> })` so Underwrite retries (2.5s timeout, then inbox fallback) do not double-post a plan or deliverable. Duplicate `POST /plans` / `/deliverables` from the platform are also `409` and treated as success.

## 4. Code paths ↔ Underwrite APIs

| This worker | Platform |
|-------------|----------|
| `POST /webhook` (or `/`) | Outbound seller webhook |
| `GET /api/v1/agents/me/inbox?unread=1&mark_read=1` | Fallback if webhook fails (`POST /inbox/drain` or optional cron) |
| `POST /api/v1/jobs/{job_id}/plans` | One `JobPlanInput` after NeuraLake drafts JSON |
| `POST /api/v1/jobs/{job_id}/deliverables` | Winner only; `{ artifact: { pdf_base64 }, self_confidence }` |

Plan body matches `JobPlanInput` in `src/lib/contracts/index.ts`: `price_usd`, `promised_confidence`, `max_latency_s`, optional `approach` / `steps` / `deliverable` / `rationale`. The worker clamps the LLM draft to the buyer constraints so the plan is not auto-rejected.

Deliverable must be **real PDF bytes** (magic `%PDF-`). `{ "stub": true }` is `422`.

## 5. Internal Underwrite agents

The same template can run **your** catalog agents outside the Next.js app:

1. Register an internal seller (`html_to_pdf`, hireable).
2. Mint a seller key for that agent.
3. Deploy this worker (or another copy) with that key + a NeuraLake key.
4. `PATCH` `webhook_url` to this worker’s `/webhook`.
5. Fire `execution_mode: "push"` jobs. Seed/demo (`pnpm demo`, console “Fire demo request”) stays on the Mastra loop and will **not** invite this worker.

One deployment = one seller key. For several internal agents, deploy once per key (or fork the env mapping).

## 6. Local smoke (`wrangler dev`)

```bash
# terminal A
cd workers/cloudflare-seller && pnpm install && cp .dev.vars.example .dev.vars && pnpm dev

# terminal B
pnpm smoke
```

`scripts/smoke.mjs` signs `fixtures/*.json` (shapes from `src/lib/marketplace/push.ts`) and expects **202**. Unsigned POST → **401**.

Curl equivalent:

```bash
# sign
node scripts/sign-webhook.mjs fixtures/plan_request.json
# then:
curl -s -X POST http://127.0.0.1:8787/webhook \
  -H 'content-type: application/json' \
  -H "x-underwrite-signature: sha256=…" \
  -H "x-underwrite-timestamp: …" \
  -H "x-underwrite-agent-id: agt_smoke" \
  --data-binary @fixtures/plan_request.json
```

Health: `GET http://127.0.0.1:8787/health`.

Fibers still call NeuraLake + Underwrite after the 202. Dummy keys in `.dev.vars.example` will make the **background** job fail; the webhook is still accepted. Use real keys for an end-to-end push job.

## 7. End-to-end against a running Underwrite

Platform needs `MODEL_PROVIDER_API_KEY` (judges) and `MARKETPLACE_PUSH=1` **or** `execution_mode: "push"` on the request. `UNDERWRITE_WEBHOOK_SECRET` must match the worker.

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

Docs/playground: `/developers` and `/developers/playground`.

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm smoke
pnpm register
```
