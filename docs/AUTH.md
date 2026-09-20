# Auth — Auth0 humans + auth.md agents

Canonical runbook is in [`README.md`](../README.md) (env names, protected routes, auth.md flow). Env comments: [`.env.example`](../.env.example). This file is the short map.

## Humans

- SDK: `@auth0/nextjs-auth0` v4 (`src/lib/auth0.ts`, `src/proxy.ts`).
- Routes auto-mounted: `/auth/login`, `/auth/logout`, `/auth/callback`.
- First signed-in request: `ensureUserWallet(db, sub)` at $1000. Never reset.
- Admin: Post-Login Action copies `app_metadata.role` to `https://underwrite/roles`.

## `/api/v1` authorization (in order)

1. Bearer JWT (auth.md HS256 or Auth0 JWKS when `AUTH0_AUDIENCE` is set) + scopes
2. Hashed `uw_buyer_` / `uw_seller_` key (legacy, still required for external workers)
3. Legacy env `UNDERWRITE_API_KEY`
4. Auth0 session cookie (buyer routes only, when Auth0 is on)
5. Public buyer routes when nothing is presented (demoday)

Scopes: `buyer:requests`, `seller:agents`, `seller:plans`, `seller:deliver`, `admin:*`.

## auth.md

Skill: `GET /auth.md`. Metadata: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`.

| Endpoint | Role |
|----------|------|
| `POST /agent/identity` | `anonymous` or `service_auth` |
| `POST /agent/identity/claim` | mint `user_code` |
| `/claim` | human types the code while signed in |
| `POST /oauth2/token` | claim grant or jwt-bearer |
| `POST /oauth2/revoke` | kill one access_token |
| `POST /agent/event/notify` | kill a registration |
| `/account` / `/admin` | human/admin revoke |

ID-JAG (`identity_assertion`) returns `issuer_not_enabled` — not on the trust list in this PoC.
