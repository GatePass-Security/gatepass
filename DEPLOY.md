# Deploying Gatepass for free

The whole hosted product runs at $0/month on free tiers, no credit card required:

| Piece | Service | Free tier |
|---|---|---|
| API (`apps/api`) | [Render](https://render.com) web service | 750 instance-hours/mo (sleeps after 15 min idle) |
| Dashboard (`apps/web`) | [Vercel](https://vercel.com) hobby | Unlimited static + serverless for personal use |
| Database | [MongoDB Atlas](https://mongodb.com/atlas) M0 | 512 MB, free with **no expiry** |

> **Do not use Render's own free Postgres for this.** It is deleted 30 days after creation, so a
> demo built on it dies on a timer nobody is watching. Atlas M0 has no such clock. Neon's free
> tier also works if you prefer Postgres — set `DATABASE_URL` instead of `MONGODB_URI`.

## The one variable that breaks everything if it is missing

`GATEPASS_API_URL`, on the **dashboard**. It is how Vercel's server-side code finds the API.
Without it the dashboard falls back to `http://localhost:3000` — its own loopback, where nothing
is listening — and every page including sign-in fails to reach the API. The System page shows
the resolved value and flags it in red when it was defaulted rather than set.

It is a plain runtime variable, not a `NEXT_PUBLIC_` one, so changing it takes effect on the
next deploy without needing the bundle rebuilt. (`NEXT_PUBLIC_API_URL` is still read as a
fallback so older deployments keep working.)

## 1. Neon (Postgres) — optional, ~3 minutes

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
2. Fill in the env vars it prompts for. **Set exactly one storage variable** — the API prefers
   Mongo, then Postgres, then an in-memory store that loses everything on restart:
   - `MONGODB_URI` — the Atlas SRV string. Leave `DATABASE_URL` blank; it is never read once
     this is set. (Taking the Neon route instead? Do the reverse — fill `DATABASE_URL` from
     step 1 and leave `MONGODB_URI` blank.)
   - `SESSION_SECRET` — any long random string; it signs session cookies
   - **A way to sign in.** Without one of these a production deployment has no way in at all,
     because the local development sign-in is refused outright when `NODE_ENV=production`:
     - `GATEPASS_LOCAL_USERS` — `login:scrypt-hash:role`, hashes only. Generate one with
       `pnpm --filter @gatepass/api hash-password`.
     - and/or `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`
   - `GATEPASS_ALLOWED_ORIGINS` — your Vercel URL once you have it (step 3), e.g.
     `https://gatepass.vercel.app`. Compared to the browser's `Origin` header as an exact
     string, so no trailing slash, no path, and the scheme is required.
   - `GATEPASS_WEB_URL` — the same Vercel URL; `/healthz` reports it back
   - Optional, all of which degrade gracefully when absent:
     - `GITHUB_APP_ID` / `GITHUB_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY` (paste the **full
       PEM content** — Render env vars accept multi-line values) and `GITHUB_WEBHOOK_SECRET`
       to match step 4. Without them, scanning still works but reaches public repos only.
     - `NVIDIA_API_KEY` — research-tier LLM refinement
     - `GATEPASS_RUNNER_TOKENS` / `GATEPASS_ADMIN_TOKEN` — see below
3. Deploy. Health check is `GET /healthz`.

The first line of the log says which store won, and is worth reading rather than assuming:
`Gatepass API on :10000 (store: mongodb)`. If it says `store: memory`, neither variable reached
the process — the API will come up and answer normally while writing your scan history into a
Map that dies on the next restart. If the deploy instead fails its health check, the usual cause
is Atlas **Network Access** not allowing `0.0.0.0/0`: a store that is configured but unreachable
stops the process on purpose, rather than booting into a state that silently loses data.

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

### Keeping the API awake — and why the workflow alone does not do it

The service sleeps after 15 min idle and the first request after that pays the whole wake, 25–50s
measured against this deployment. [`.github/workflows/keep-api-warm.yml`](.github/workflows/keep-api-warm.yml)
pings `GET /healthz` on a `*/10 * * * *` schedule. Actions minutes are unlimited here because the
repository is public, so it costs nothing.

**It does not keep the service warm, and the run history says so.** Measured over the first
7½ hours after it went live, consecutive runs arrived at:

```
11:05Z  12:11Z  14:01Z  15:15Z  16:17Z  17:27Z  18:32Z
```

Gaps of 66, 110, 74, 62, 70 and 65 minutes against a cron asking for 10 — GitHub delivered
roughly one run in seven. Every one of them is green, because each ping did succeed; the run
*durations* are where the failure shows, at 1m41s, 1m37s and 1m02s, which is the workflow paying
the cold start it exists to prevent. `schedule:` is best-effort and heavily throttled, and no
part of the Actions interface reports a run that was never started.

So treat the workflow as a backstop and **use a free external monitor as the actual mechanism**:
[UptimeRobot](https://uptimerobot.com) → **+ New monitor** → type **HTTP(s)**, URL
`https://gatepass-api-1zn8.onrender.com/healthz`, interval **5 minutes**, add your email alert
contact → **Create**. It fires on time, and it tells you when the API is genuinely unreachable —
which the workflow structurally cannot, since a schedule that stops firing emits no signal at all
(GitHub also disables scheduled workflows in repositories with no commits for 60 days).

**The quota this runs into.** Render's 750 instance-hours/month are granted per *workspace* and
are consumed only while a service is awake, so a pinger that genuinely succeeds costs:

| Kept awake | 31-day month | Headroom against 750 |
|---|---|---|
| Round the clock | 744 h | **6 h** |
| 16 h/day (e.g. `*/10 13-23,0-4 * * *`) | 499 h | 251 h |

Going over 750 does not slow the service down, it **suspends it until the 1st of the next
month** — the API dark for days, far worse than the cold start being avoided. Round-the-clock
fits while `gatepass-api` is the workspace's only free service and stops fitting the moment
there is a second one: two services held awake together exhaust 750 h by around the 15th and
both go down. If you add another free service, narrow the schedule to a daily window rather
than leaving both at 24/7.

## 3. Vercel (dashboard) — ~3 minutes

1. Sign up at **vercel.com** (GitHub SSO) → **Add New → Project** → import `gatepass`.
2. Set **Root Directory** to `apps/web` (framework auto-detects Next.js).
3. Env var: **`GATEPASS_API_URL`** = your Render URL, with scheme and no trailing slash.
   Apply it to Production, Preview and Development.

   > Copy this from the Render dashboard, do not type it from the service name. Render appends a
   > random suffix when the name is already taken, so the host is usually something like
   > `https://gatepass-api-1zn8.onrender.com` rather than `https://gatepass-api.onrender.com`.
   > The two failures that follow from guessing it — a dashboard that cannot reach the API, and a
   > GitHub webhook posting into nothing — both look like something else entirely.
4. Deploy, note the URL, and put it in Render's `GATEPASS_ALLOWED_ORIGINS` **and**
   `GATEPASS_WEB_URL`.

Check it worked by opening **/system** on the deployed dashboard: "API base" should show your
Render URL. If it shows `http://localhost:3000` with a red note underneath, the variable did not
reach the build — confirm it is set for the Production environment and redeploy.

## 4. Point the GitHub App at production — ~2 minutes

In **github.com/settings/apps → your app**:

- **Webhook URL**: your Render URL from step 3 with `/v1/webhooks/github` appended — the real
  host including its random suffix, e.g. `https://gatepass-api-1zn8.onrender.com/v1/webhooks/github`
- **Webhook secret**: the same value as Render's `GITHUB_WEBHOOK_SECRET`
- **OAuth callback**: add your Vercel URL's callback path

From then on every push/PR on repos with the App installed triggers a hosted clone-and-scan.

## Known limits of the free stack (fine for demo/YC, revisit at first customers)

- Render free sleeps → webhook deliveries during cold start can exceed GitHub's 10s timeout
  (GitHub does not retry). The keep-warm workflow above does not close this, because it is
  delivered roughly every 70 minutes rather than every 10 — see the measurement there. An
  external 5-minute monitor does close it. Until one is running, treat the service as cold by
  default and hit `/healthz` yourself a minute before a demo you care about.
- Neon free autosuspends; first query after idle adds ~1s.
- Scans run in the API process (no per-scan container isolation yet — that's the ECS Fargate
  plan for paid infra). Scan input is tarball extraction with a tar-slip guard, never
  executed code.
- Row-level security policies from the retired handwritten migrations are not yet
  re-applied on the generated schema; the API is the only DB client today. Reinstate RLS
  before multi-tenant production traffic.
