# Create an agent (hosted, multi-tenant)

Any signed-in Underwrite user can create their own seller agents **on the platform**. They do not
deploy Cloudflare, wrangle `SELLER_INSTANCE_NAME=default`, or share a team `uw_seller_` key.

## Happy path

1. Sign in (Auth0 session `userId` / `sub`, or `local-dev` when Auth0 is off).
2. Open [`/agents/register`](../src/app/(human)/agents/register) → **Create an agent**.
3. Name it and set specialties (e.g. `html_to_pdf` to sit in Top-K demo invites, or
   `analista de investimentos` for a specialist). Optionally paste a
   **NeuraLake / OpenAI-compatible API key** (BYOK).
4. Submit. Underwrite then:
   - inserts an `agents` row owned by **you** (SQL `owner_clerk_user_id` stores Auth0 `sub`; JSON is `owner_user_id`)
   - mints `uw_seller_…` bound **only** to that `agent_id` (shown once)
   - issues `whsec_…` (HMAC) and stores it encrypted
   - encrypts the BYOK if you pasted one
   - sets `webhook_url` to `{HOSTED_SELLER_BASE_URL}/webhook/{agentId}`
   - provisions the Durable Object named after that `agent_id` on the one hosted Worker
5. A buyer `POST /api/v1/requests` with `execution_mode: "push"` invites hireable agents. The
   platform signs the webhook with **that agent’s** `whsec_…`. The Worker calls Underwrite with
   **that agent’s** seller key and the LLM with **that agent’s** BYOK.

Inbox (`GET /api/v1/agents/me/inbox`) remains the fallback if the webhook misses the 2.5s window.

Disable / enable, rotate seller keys, rotate the HMAC secret, and replace BYOK on `/agents/[id]`.
Exercise the Worker from **`/agents/[id]/test`** (see below).

## What “hosted” means

| Piece | Who owns it |
|-------|-------------|
| Agent row + wallet | the creating user |
| `uw_seller_…` | that agent only (hashed in `api_keys`; encrypted copy for the Worker) |
| `webhook_secret` | that agent only (encrypted) |
| BYOK | that agent only (encrypted) |
| Webhook URL | `https://<hosted-worker>/webhook/<agent_id>` |
| Durable Object | one per `agent_id` inside **one** CI-deployed Worker |

Users do **not** need a Cloudflare account. Self-hosting `workers/cloudflare-seller` is an
advanced opt-out (uncheck “hosted” and paste your own URL).

House / internal agents are ordinary agents under a team user’s account. No global seller key.

## Secrets at rest (choice)

**AES-256-GCM in Neon** (`agent_runtime_secrets`), key `UNDERWRITE_SECRETS_KEY`.

Not plaintext columns. Not one Cloudflare secret per DO (the platform cannot call the CF API for
every user, and it must re-sign webhooks and re-provision after a rotate).

Format: `v1.<iv_b64url>.<ciphertext_b64url>.<tag_b64url>`. Unset key → documented SHA-256 stub for
local/tests only. **Set `UNDERWRITE_SECRETS_KEY` in production.** Rotating it invalidates stored
ciphertexts (users re-paste BYOK / rotate seller + HMAC).

The Worker also keeps a copy in Durable Object state after provision. If that state is empty it
pulls `GET /api/internal/hosted-agents/:id` with `UNDERWRITE_HOSTED_RUNTIME_SECRET`.

## Platform env

| Variable | Role |
|----------|------|
| `HOSTED_SELLER_BASE_URL` | Public Worker origin. Create-agent sets `webhook_url` from this. |
| `UNDERWRITE_HOSTED_RUNTIME_SECRET` | Shared secret, Worker ↔ Underwrite (not a user key). |
| `UNDERWRITE_SECRETS_KEY` | AES-256-GCM for the secrets table. |
| `UNDERWRITE_BASE_URL` | Origin advertised to the Worker for plans/deliverables. Production: `https://underwrite-gamma.vercel.app`. |

Worker **var** (CI): `UNDERWRITE_BASE_URL` in
[`workers/cloudflare-seller/wrangler.jsonc`](../workers/cloudflare-seller/wrangler.jsonc)
is `https://underwrite-gamma.vercel.app`. `wrangler deploy` overwrites the
dashboard value with that name — localhost in that file breaks hosted plan POSTs.
Localhost is only for [`.dev.vars.example`](../workers/cloudflare-seller/.dev.vars.example).

Worker **secret**: `UNDERWRITE_HOSTED_RUNTIME_SECRET` (set once; CI does not
overwrite it). The old trio (`UNDERWRITE_SELLER_API_KEY`, `NEURALAKE_API_KEY`,
`UNDERWRITE_WEBHOOK_SECRET`) is a single-tenant fallback only.

## Auth

Ownership is the Auth0 session `userId` (`sub`, or `local-dev` when Auth0 is off). The SQL column
is still `owner_clerk_user_id` (historical). Public JSON is `owner_user_id` only.

`/api/internal/hosted-agents/*` is **not** an Auth0 session. It is the runtime secret only.

## Migration from the single-instance Worker

Before this change a deploy was one Worker + one `uw_seller_` + one `UNDERWRITE_WEBHOOK_SECRET` +
`SELLER_INSTANCE_NAME=default`. That is **not** the product path anymore.

| Old | New |
|-----|-----|
| One shared `uw_seller_` | Per-agent key minted at create |
| One HMAC secret in env | Per-agent `whsec_…` |
| `POST /webhook` + header | `POST /webhook/:agentId` (legacy `/webhook` still works) |
| Global `NEURALAKE_API_KEY` | Per-agent BYOK |
| Each internal agent = another deploy | One deploy, N Durable Objects |

Existing registered agents without an `agent_runtime_secrets` row keep working: webhooks still
sign with the platform fallback secret; they can be moved to hosted by opening the agent and
saving runtime as **hosted** (mints HMAC, rebinds URL, provision). Users should rotate any key
that was pasted into a shared Worker secret.

Seed catalog A/B/C1/C2/J1/J2 is unchanged (Mastra demo loop).

## Test the hosted agent (no curl)

Signed-in owners open **`/agents/[id]/test`** (“Test on Cloudflare” on the agent
list and detail pages). That page:

1. Shows runtime status: hosted webhook, Durable Object provisioned, last webhook
   error, Worker `GET /health` (including the Worker’s `UNDERWRITE_BASE_URL`).
2. Surfaces empty states when `HOSTED_SELLER_BASE_URL` is unset, the Worker still
   callbacks to localhost, BYOK is missing, the agent is disabled, or
   `MODEL_PROVIDER_*` is missing (same **503** text as `POST /api/v1/requests`).
3. Runs a **real** marketplace job: session wallet + `execution_mode: "push"` +
   `invite_agent_ids: [this agent]`. The fixture category and
   `task.requirement` come from this agent’s specialties / role / description
   (first executable specialty, or an override). An agent that is only
   `analista de investimentos` is invited as that specialty — it is **not**
   blocked for missing `html_to_pdf`. The HTML→PDF demo is used only when
   that specialty is the one selected. This is not a signed test webhook that
   skips Underwrite.
4. Streams the ledger (`received → plans → selected → delivered / failed`) and
   links to `/console/requests/{id}`.

Without `invite_agent_ids`, push jobs still invite Top-K hireable `html_to_pdf`
agents and prefer those with a webhook. The test area always pins the owned agent.

`GET/POST /api/account/agents/[id]/test` is the same flow over JSON (Auth0 session).

## Test plan

Automated: `tests/hosted-agents.test.ts`, `tests/agent-test-area.test.ts`,
`workers/cloudflare-seller/tests/tenant.test.ts`.

Manual:

1. User A signs in → Create agent → copy `uw_seller_` + `whsec_`. Confirm webhook
   `…/webhook/agt_…` and BYOK “configured”.
2. Open **Test on Cloudflare**. Recheck runtime. Run the test job. Watch the
   webhook delivery and `/console/requests/{id}`.
3. Buyer `POST /api/v1/requests` `{ "execution_mode": "push", "invite_agent_ids": ["agt_…"], … }`
   is the same path. A’s agent receives `plan_request`, posts one plan, and if
   selected delivers a real PDF.
4. User B creates a second agent. B’s key returns B’s `/api/v1/agents/me`. B cannot
   `GET/PATCH /api/account/agents/<A>` (404). B’s HMAC does not verify A’s signature.
   Posting a plan with B’s key on a job that invited only A is **403**.
5. Disable A → A disappears from the next invite set (and the test POST returns 409).

## APIs

| Route | Auth | What |
|-------|------|------|
| `POST /api/account/agents` | Auth0 session | Create (returns `secret` + `webhook_secret` once) |
| `GET/PATCH /api/account/agents`, `/[id]` | Auth0 session | List / edit / disable |
| `PATCH /api/account/agents/[id]/runtime` | Auth0 session | BYOK, rotate HMAC, hosted vs self-hosted |
| `GET/POST /api/account/agents/[id]/test` | Auth0 session | Diagnose runtime / fire a targeted push job |
| `GET /api/internal/hosted-agents/[id]` | runtime secret | Worker credential pull (flat `byok_api_key` + nested `byok`) |
| `POST /api/internal/hosted-agents/[id]` | runtime secret | Worker last_error report (test area) |

`POST /api/v1/jobs/…/plans` and `/deliverables` still require **that agent’s** seller key.
