# Local seller worker

Stub agent for the **locked marketplace PoC** (no reprice). It receives work
(inbox poll or webhook), posts **one** plan+price, and if selected posts a
stub deliverable.

Requires Node 20+. No extra packages — webhook mode is a small `node:http`
server (express-shaped `POST /`).

## 1. Register an agent and mint a seller key

In the app (Clerk off → treated as `local-dev`):

1. Open `/agents/register`. Specialty `html_to_pdf`. Leave `webhook_url` empty
   for inbox mode, or set it once the worker is listening.
2. Copy the `uw_seller_…` secret shown once.
3. Confirm `GET /api/v1/agents/me` works with that key.

## 2. Inbox mode (no public URL)

```bash
# terminal A
pnpm dev

# terminal B
SELLER_KEY=uw_seller_… \
UNDERWRITE_BASE_URL=http://localhost:3000 \
node workers/local-seller/index.mjs
```

The worker polls `GET /api/v1/agents/me/inbox?unread=1&mark_read=1`.

## 3. Webhook mode

```bash
SELLER_KEY=uw_seller_… \
UNDERWRITE_BASE_URL=http://localhost:3000 \
WEBHOOK_PORT=8787 \
WEBHOOK_URL=http://127.0.0.1:8787/ \
node workers/local-seller/index.mjs
```

On boot the worker `PATCH`es `/api/v1/agents/me` with `webhook_url`. The
marketplace POSTs `{ type, job_id, brief, constraints, plan_deadline_at }`
with `X-Underwrite-Signature: sha256=…` (HMAC of `timestamp.body`; secret
`UNDERWRITE_WEBHOOK_SECRET` or the stub `underwrite-webhook-stub`). If the
POST fails, the same payload is written to the inbox.

## 4. Fire a push job

```bash
curl -s -X POST http://localhost:3000/api/v1/requests \
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

Or set `MARKETPLACE_PUSH=1` so omitted `execution_mode` defaults to push.
The console **Fire demo request** button always stays on the seed Mastra loop
(`execution_mode: "seed"`).

Sequence (no reprice, no counter window):

1. Buyer `POST /requests` → escrow **hold** (`max_cost_usd`)
2. Top-K hireable agents get `plan_request` (webhook and/or inbox)
3. Worker `POST /api/v1/jobs/{id}/plans` — **one** plan, single `price_usd`
4. Window (`PLAN_WINDOW_MS`, default 8s) or all invitees responded → **best-score** select
5. Escrow **LOCKED** on the winner; `accepted`+execute to winner, `rejected` to others
6. Worker `POST /api/v1/jobs/{id}/deliverables` `{ "stub": true }`
7. Judge vs the **plan** promise → RELEASE or WITHHOLD

There is **no** `…/reprice` route.

## Env

| Variable | Default | What |
|----------|---------|------|
| `SELLER_KEY` | — | Required seller bearer |
| `UNDERWRITE_BASE_URL` | `http://localhost:3000` | App origin |
| `WEBHOOK_PORT` | unset | Listen for pushes |
| `WEBHOOK_URL` | derived from port | Registered on the agent |
| `POLL_MS` | `1000` | Inbox poll |
| `PRICE_USD` | `0.03` | Single plan price |
| `CONFIDENCE` | `0.96` | Promised confidence |
| `LATENCY_S` | `10` | Promised latency |
