# Deploying Gatepass for free

The whole hosted product runs at $0/month on free tiers, no credit card required:

| Piece | Service | Free tier |
|---|---|---|
| API (`apps/api`) | [Render](https://render.com) web service | 750 instance-hours/mo (sleeps after 15 min idle) |
| Dashboard (`apps/web`) | [Vercel](https://vercel.com) hobby | Unlimited static + serverless for personal use |
| Postgres | [Neon](https://neon.tech) | 0.5 GB storage, autosuspend |

## 1. Neon (Postgres) — ~3 minutes

1. Sign up at **neon.tech** (GitHub SSO), create a project `gatepass`.
2. Copy the **connection string** (looks like `postgresql://user:pass@ep-…aws.neon.tech/neondb?sslmode=require`).
3. Apply the schema from your machine:

```bash
DATABASE_URL="<neon connection string>" pnpm db:migrate
```

Migrations are generated from `packages/shared/db/schema.ts` (the schema PgStore actually
queries) and tracked in `__drizzle_migrations` — re-running is a no-op.

## 2. Render (API) — ~5 minutes

1. Sign up at **render.com** (GitHub SSO) → **New → Blueprint** → select the `gatepass` repo.
   Render reads [render.yaml](render.yaml) and creates the `gatepass-api` service.
2. Fill in the env vars it prompts for:
   - `DATABASE_URL` — the Neon string from step 1
   - `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID` — from github.com/settings/apps
   - `GITHUB_APP_PRIVATE_KEY` — paste the **full PEM file content** (Render env vars accept
     multi-line values; no file needed)
   - `GITHUB_WEBHOOK_SECRET` — any long random string; must match step 4
   - `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` / `SESSION_SECRET` — as in `.env.example`
   - `NVIDIA_API_KEY` — for research-tier LLM refinement (optional; scans degrade gracefully)
   - `GATEPASS_ALLOWED_ORIGINS` — your Vercel URL once you have it (step 3), e.g.
     `https://gatepass.vercel.app`
   - `GATEPASS_RUNNER_TOKENS` / `GATEPASS_ADMIN_TOKEN` — optional; see below
3. Deploy. Health check is `GET /healthz`.

### Write credentials (both fail closed)

Two endpoints are not reached through a browser session and therefore carry their own bearer
token. **Leave either unset and that route rejects every request** — that is the intended
default, so a deployment that does not use these features is not exposing them.

| Env var | Enables | Format |
|---|---|---|
| `GATEPASS_RUNNER_TOKENS` | `POST /v1/runner/results` | `orgId:token,orgId:token` — one token per org |
| `GATEPASS_ADMIN_TOKEN` | `POST /v1/benchmark/publish` | a single opaque token |

Generate them with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
The API stores only SHA-256 hashes and compares in constant time; plaintext is never retained
or logged. On boot the API logs whether each is enabled — an absent line means that route is
rejecting everything.

The org a runner may write to is a property of its **token**, not of the payload: a request
whose body names a different org is rejected with 403 rather than redirected. Rotate a token by
replacing its pair and redeploying; there is no revocation list yet (see
`contracts/api.md` → Implementation status).

**Free-tier caveat:** the service sleeps after 15 min idle; the first request after that
takes ~40s. For demos, a free [UptimeRobot](https://uptimerobot.com) monitor pinging
`/healthz` every 10 min keeps it warm (750 free hrs/mo covers one always-on service).

## 3. Vercel (dashboard) — ~3 minutes

1. Sign up at **vercel.com** (GitHub SSO) → **Add New → Project** → import `gatepass`.
2. Set **Root Directory** to `apps/web` (framework auto-detects Next.js).
3. Env var: `NEXT_PUBLIC_API_URL` = your Render URL (e.g. `https://gatepass-api.onrender.com`).
4. Deploy, note the URL, and put it in Render's `GATEPASS_ALLOWED_ORIGINS`.

## 4. Point the GitHub App at production — ~2 minutes

In **github.com/settings/apps → your app**:

- **Webhook URL**: `https://gatepass-api.onrender.com/v1/webhooks/github`
- **Webhook secret**: the same value as Render's `GITHUB_WEBHOOK_SECRET`
- **OAuth callback**: add your Vercel URL's callback path

From then on every push/PR on repos with the App installed triggers a hosted clone-and-scan.

## Known limits of the free stack (fine for demo/YC, revisit at first customers)

- Render free sleeps → webhook deliveries during cold start can exceed GitHub's 10s timeout
  (GitHub does not retry). The UptimeRobot ping mitigates this.
- Neon free autosuspends; first query after idle adds ~1s.
- Scans run in the API process (no per-scan container isolation yet — that's the ECS Fargate
  plan for paid infra). Scan input is tarball extraction with a tar-slip guard, never
  executed code.
- Row-level security policies from the retired handwritten migrations are not yet
  re-applied on the generated schema; the API is the only DB client today. Reinstate RLS
  before multi-tenant production traffic.
