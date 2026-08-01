# Contract: Platform API (REST, `/v1`)

Auth: session (dashboard) or org-scoped API keys; runner endpoints use runner tokens.
All responses JSON; errors RFC 7807. RBAC: viewer=read, member=read+dispute+scan,
admin=settings+tokens+exports.

## Orgs, repos, settings

| Method & Path | Purpose | Notes |
|---|---|---|
| GET /orgs/:org | Org profile, plan tier | |
| GET /orgs/:org/repos | Connected repos + scan settings | mirrors GitHub visibility (FR-027) |
| GET /orgs/:org/repos/available | Installation repos not yet connected | read-only; empty when no GitHub App |
| POST /orgs/:org/repos | Connect `{repo}` (`owner/name`) | member; a GitHub read plus a row |
| PATCH /orgs/:org/repos/:repo | Set gate_mode, gate_failure_mode, agent_loop_enabled | admin; FR-014/016/016a |
| DELETE /orgs/:org/repos/:repo | Disconnect | admin; scans/findings are kept |
| PATCH /orgs/:org/settings | llm_analysis_enabled etc. | admin; FR-011a |

`:repo` is **one URL-encoded path segment** (`encodeURIComponent("owner/name")`), because a
repository name contains a slash and a local-path scan target is an absolute path.

## Scans & findings

| Method & Path | Purpose | Notes |
|---|---|---|
| POST /orgs/:org/repos/:repo/scans | Trigger on-demand scan | FR-006 |
| GET /scans/:id | Status + stage timings | |
| GET /orgs/:org/findings | Everything currently open for the org | each connected repo's latest scan; findings carry `scanId` + `repo`; scope-filtered like GET /orgs/:org/scans |
| GET /scans/:id/findings | Findings (canonical schema) | filter: tier, class, severity, status |
| GET /scans/:id/findings.sarif | SARIF export | |
| POST /findings/:id/dispute | Open dispute | FR-011 |
| POST /findings/:id/agent-guidance | Fetch structured fix guidance | 403 unless repo agent_loop_enabled (FR-014) |

## Fleet (Scale tier)

| Method & Path | Purpose | Notes |
|---|---|---|
| POST /orgs/:org/fleet/servers | Register MCP server | FR-024 |
| GET /orgs/:org/fleet | Aggregated posture view | per-server + rollup |
| POST /orgs/:org/fleet/servers/:id/rescan | Manual rescan | change-detection also triggers |

## Evidence & questionnaires (Scale tier)

| Method & Path | Purpose | Notes |
|---|---|---|
| POST /orgs/:org/integrations/vanta\|drata | Connect platform | admin |
| GET /orgs/:org/evidence-exports | Export history + traceability | every item cites scan_id (SC-008) |
| POST /orgs/:org/questionnaires | Upload questionnaire (csv/xlsx/sig-lite) | drafts answers from posture only (FR-022/023) |
| GET /orgs/:org/questionnaires/:id | Drafts for human review | review_status workflow |

## Public (no auth)

| Method & Path | Purpose | Notes |
|---|---|---|
| GET /public/benchmark | Latest published benchmark results | per-class TP/FP per tool per corpus tag (FR-018) |
| GET /public/benchmark/:corpusVersion | Historical, immutable | SC-007 reproducibility |
| GET /public/reports/:slug | Public server-scan reports | post-disclosure only (FR-020) |

**Availability**: 99.9% SLO on scan-critical paths (SC-011). Rate limits per org token;
429 with Retry-After.

## Implementation status

The tables above are the target contract. `apps/api/src/server.ts` is a hand-rolled
`node:http` router standing in for the production app, and it does not yet cover all of it.
Audited against the router on 2026-07-27:

**Diverges from the contract as written**

| Contract | Implemented as | Note |
|---|---|---|
| POST /orgs/:org/repos/:repo/scans | POST /orgs/:org/scans `{path}` | plus POST /orgs/:org/scan-remote `{repo, ref}` for clone-and-scan |
| POST /findings/:id/agent-guidance | GET /orgs/:org/scans/:id/agent-guidance?fingerprint= | |
| POST /orgs/:org/fleet/servers/:id/rescan | POST /fleet/servers/:id/rescan | no org segment, and no org check |
| POST /orgs/:org/integrations/vanta\|drata | POST /orgs/:org/evidence/export `{scanId, platform}` | |
| GET /orgs/:org/evidence-exports | GET /orgs/:org/evidence?scanId= | returns control coverage (`EvidenceItem[]`), not export history |

**Not implemented**

`GET /scans/:id`, `GET /orgs/:org/questionnaires/:id`, `GET /public/reports/:slug`.

**Repositories are real as of 2026-07-27.** `PATCH /orgs/:org/repos/:repo` was on this list
because there was no per-repo settings storage; there is now (`RepoRecord` in
`apps/api/src/store.ts`, the `repositories` table plus migration `0002_repo_connect.sql`, and
`PgStore.connectRepo`/`getRepos`/`updateRepo`/`deleteRepo`, which previously did not exist at
all — every Postgres deployment answered `[]` to `GET /orgs/:org/repos`). Repos can now be
connected explicitly rather than only appearing as a side effect of a scan, and disconnected.

Three fields `listRepos` used to fabricate are now facts or absent:

| Field | Was | Is |
|---|---|---|
| `visibility` | the literal `"private"` on every row | read from GitHub via `GET /repos/{owner}/{name}`, and **omitted from the response entirely** when no GitHub App is configured |
| `frameworks` | always `[]` | written by the scan that detected them |
| `gate_mode` / `gate_failure_mode` | deployment defaults | per-repo, stored, `PATCH`-able |

The omission is the load-bearing part: a security dashboard that prints "Private" beside a
public repository has told the operator something false about their exposure. Absent means
not known, and the dashboard renders nothing for it.

**Implemented beyond the tables**

`GET /healthz`, `GET|POST /v1/auth/github/*`, `GET /v1/auth/me`, `POST /v1/webhooks/github`,
`POST /scans/:id/gate`, `POST /v1/runner/results`, `POST /v1/benchmark/publish`,
`POST /orgs/:org/compliance/scan`, `GET /orgs/:org/compliance/results/:scanId`.

**Dashboard coverage** (as of 2026-07-27): every route the router answers is now reachable from
`apps/web`, so nothing is callable by curl and by nothing else. The previously-unreachable set
was `POST /orgs/:org/scans` (local-path scan), `GET /scans/:id/findings.sarif`,
`POST /scans/:id/gate`, `GET /orgs/:org/repos`, `GET /orgs/:org/evidence`,
`POST /orgs/:org/evidence/export`, `POST /orgs/:org/questionnaires`, and both compliance routes.
The three that remain machine-to-machine — `POST /v1/webhooks/github`, `POST /v1/runner/results`,
`POST /v1/benchmark/publish` — carry credentials a browser must not hold, so `/system` reports
their configuration state instead of offering to invoke them. It determines that by sending an
unauthenticated request and reading which of the two fail-closed messages comes back, which
writes nothing.

`PATCH /orgs/:org/settings` was contract-only until 2026-07-27 and is now implemented for
`llm_analysis_enabled` and `agent_loop_enabled` (org scope; unknown keys ignored, so plan
tier and org id are not writable). Covered by `apps/api/test/org-settings.test.ts`.

**Write auth on the two non-browser endpoints** (added 2026-07-27, `apps/api/src/tokens.ts`):

| Route | Credential | Env |
|---|---|---|
| POST /v1/runner/results | org-scoped runner token, `Authorization: Bearer` | `GATEPASS_RUNNER_TOKENS` (`orgId:token,…`) |
| POST /v1/benchmark/publish | operator token, `Authorization: Bearer` | `GATEPASS_ADMIN_TOKEN` |

Both fail closed: unset ⇒ the route rejects every request with 401. Tokens are compared as
SHA-256 digests in constant time and are never stored or logged in plaintext. The runner's
target org is derived from the **token**, not the payload — a body naming a different org gets
403. Covered by `apps/api/test/write-auth.test.ts`.

Still outstanding on these two:

- **No revocation or rotation without redeploy.** `RunnerToken.revoked_at` and
  `min_ruleset_version` (data-model.md:175) are not implemented; tokens live in env, not in the
  store, so there is no per-token revoke.
- **No AuditEvent on upload.** runner-protocol.md guarantee 3 requires one per accepted upload.
  `AuditedWriter`'s action set is deliberately outbound-only (it is the structural proof behind
  "zero repo mutations"), so inbound uploads need their own append-only sink rather than a new
  action on that enum.

**Sign-in and RBAC (implemented 2026-07-27, `apps/api/src/auth.ts`).** This section previously
read "RBAC is still not enforced". Four things it described as outstanding are closed:

| Was | Is |
|---|---|
| `authCallback` took `orgId` from the **request body** — anyone completing OAuth could mint a session for any org they named | the org is server configuration (`GATEPASS_SESSION_ORG`); the body field is not read |
| `authCallback` hardcoded `role: "member"` for everyone | resolved from the user's GitHub org membership (`GATEPASS_GITHUB_ORG`, scope `read:org`) via `roleFromGitHubOrgRole`, falling back to `GATEPASS_DEFAULT_ROLE` — which defaults to `viewer`, not `member` |
| the OAuth `state` was passed through and never checked | generated, stored in an `httpOnly` cookie on the dashboard origin, and compared in constant time on callback (`apps/web/src/app/api/auth/github/*`) |
| `X-Org-Id` outranked everything for rate-limit bucketing, so a caller could mint a fresh bucket per request | a verified session's org wins; the header is now the **last** fallback, below the path segment |
| the runner's rate-limit bucket came from `?orgId=`, which the limiter reads *before* the route validates the bearer token — the same hole, one layer down | the bucket comes from the org the token maps to; unrecognised runner traffic shares one bucket, so flooding costs the flooder their own quota |
| org-scoped **reads** answered anyone: writes were gated but every `GET` was open, so gating `/dashboard` in the web middleware bought nothing — the findings, scan history and repo inventory were one unauthenticated `curl` away | where sessions exist, reads require one too; a deployment with no `SESSION_SECRET` is unchanged (the documented open posture for a local single-tenant API) |
| a scan id was itself a credential: `/v1/scans/:id/*` compared tenants only when a session happened to be present, and the check lived only in the HTTP layer | the check runs for every scan-addressed path *and* inside `getFindings`/`getSarif`/`evaluateGate`, so a direct caller of `makeHandlers` (CLI, worker) is guarded too |

Authorization is applied once, ahead of every `/v1/orgs/:org/...` route, from the table in
`requiredRole()` — one gate rather than a check copied into fifteen route bodies, so a route
added later cannot ship ungated. Reads need no role; `member` covers scanning, disputing and
connecting; `admin` covers settings, per-repo gate policy, disconnecting, evidence export and
fix-PRs. A session for org A asking about org B is 403, never silently answered about A.

**Deployments without sessions are unchanged.** Where no `SESSION_SECRET` is configured the API
cannot issue or check a session, so requiring one would break the CLI and curl workflows this
API also serves; the guards are no-ops there. Production sets the secret, which is the direction
that has to fail closed.

**Sessions can be withdrawn.** Every token carries a `jti`, and `POST /v1/auth/signout` records
it in `revoked_sessions` (migration `0003_session_revocation`) until the token's own expiry, past
which the signature check refuses it anyway. Verification asks two questions — is this authentic
and unexpired, and has it since been withdrawn — which is why `verifySessionToken` is async.
Sign-out revokes only the token presented, so signing out of a laptop does not sign out a phone.
A correctly-signed token carrying no `jti` is refused outright: it could never be revoked, which
is the hole `jti` closes. Deployments whose store implements neither method cannot revoke, and
`handlers.revocationSupported()` reports that rather than letting sign-out appear to work.

**Access is GitHub's answer, not a list Gatepass keeps** (added 2026-07-28,
`packages/github/src/access.ts` + `apps/api/src/access.ts`, migration `0004_github_access`).
This closes the single-org limit that used to be recorded here.

An organization installs the Gatepass App on their GitHub org. From then on the people who may
use Gatepass for a repository are exactly the people GitHub already says may work on that
repository, and a Gatepass tenant *is* a GitHub org (`organizations.github_org_login`, unique).
Nobody is invited or provisioned by hand: the first sign-in from an installation creates the
tenant, and removing somebody on GitHub removes them here at the next refresh.

At sign-in, with the user's own token:

| Question | GitHub call |
|---|---|
| which orgs that I belong to have Gatepass | `GET /user/installations` |
| which repositories in each may I see | `GET /user/installations/{id}/repositories` |
| am I an owner or a member of that org | `GET /user/memberships/orgs` |

The second call is the whole model: GitHub computes the intersection of "what the installation
covers" and "what this user may see", including team grants, nested teams, outside collaborators
and repository-level overrides. Gatepass reimplements none of it.

Three properties are load-bearing and each has a test that fails when it is removed:

- **An answered `/user/installations` is final, even when the answer is none.** Only a
  *credential refusal* (401/403/404 — a classic OAuth App) falls back to the coarser
  membership-plus-collaborator path; a 5xx or a dead socket denies. Collapsing "no
  installations" into "endpoint unavailable" would hand an org owner every repository Gatepass
  tracks with no installation grant behind it.
- **Filtering, not labelling.** `GET /orgs/:org/scans` drops scans of repositories outside the
  grant rather than blanking their name — the scan id is what unlocks the findings.
- **Out of scope is 404, not 403,** on scan-addressed routes: a 403 confirms the scan exists in
  this org, which is what someone probing ids wants to learn.

Roles: an org owner is `admin`, a member is `member`. An outside collaborator is **not** in the
org, so they are capped at `member` however much they hold over an individual repository —
org settings, gate policy and evidence export are not theirs to change.

**The live grant outranks the token.** A session carries the role its holder had at sign-in and
is good for seven days, so authorizing from it meant somebody demoted from owner this morning
kept changing gate policy and opening fix pull requests until that token expired. `server.ts`
now lowers `auth.session.role` to the resolved grant's role before any gate runs, and
`GET /v1/auth/me` reports the lowered value so the dashboard stops offering controls that would
403. Downward only: a *promotion* still waits for a new token, which is the safe direction to be
slow in, and a deployment with no GitHub-derived access has no grant to consult and is
unchanged. Pinned by `apps/api/test/server-side-authz.test.ts`, which also asserts that every
privileged route refuses a viewer session called directly with no browser involved — the
dashboard's `useHasRole` is presentation, and the API is the boundary.

Caching: grants live in `user_access_grants` with a `GATEPASS_ACCESS_TTL_SEC` (default 600s)
staleness window, because a cached grant is precisely access GitHub may already have taken away.
The user's OAuth token is stored beside it so the refresh needs no fresh sign-in, and is deleted
on sign-out. A refresh *failure* keeps the last grant rather than dropping the user — the one
place this system deliberately fails open, because refusing to keep an established grant during
a GitHub incident signs everybody out while refusing to *widen* on failure is what protects the
data. The table is a cache and never a grant: truncating it costs everyone their session's
repositories and widens nobody's access by one repository.

Multi-org: `GET /v1/auth/me` returns every org the account reaches (with `repoCount` and
`accessGranularity`), and `POST /v1/auth/switch-org { orgId }` re-issues the session against
another one — checked against a freshly resolved grant, never against the request, so switching
cannot become a way to mint a session for a guessed tenant.

Per-repository access needs a **GitHub App**; a classic OAuth App cannot call
`/user/installations`. Its fallback is org membership for the tenant list plus
`GET /repos/{owner}/{repo}/collaborators/{login}/permission` per repository, asked with the App
*installation* token (a read-only collaborator asking about themselves gets 403, which is
indistinguishable from having no access). With no installation token either, the grant degrades
to org-wide and says so as `accessGranularity: "org-membership"` rather than passing itself off
as repository-level.

`GATEPASS_GITHUB_ACCESS=0` restores the older single-org posture, which is what the test suite
and the local CLI use; `GATEPASS_ALLOWED_LOGINS` and `GATEPASS_GITHUB_ORG` still admit an
operator on a deployment where the App is installed nowhere, at the unrestricted org-wide view.

**Local password accounts** (added 2026-07-28, `POST /v1/auth/password`). A door for somebody
who should be able to look at a deployment without first authorizing an OAuth app against their
personal GitHub account. `GATEPASS_LOCAL_USERS` holds `login:hash[:role]` entries — scrypt
hashes, never plaintext, dot-separated rather than the conventional `$` because the value is
delivered as an environment variable and `set -a; . .env` would expand `$32768` to nothing.
Generate with `pnpm --filter @gatepass/api hash-password <login> <role>`, which reads the
password from stdin so it stays out of `argv` and shell history. Role defaults to `viewer`.

The session is the same signed token every other door issues, at `userId: "local:<login>"` and a
24-hour TTL rather than seven days — a shared credential should have the short window. Failures
are indistinguishable by message *and* by timing: an unknown login still burns a full scrypt
(`verifyNothing`), because otherwise the form enumerates accounts by stopwatch. Refusals are 401,
not 403 — 403 would assert we recognised the caller. Attempts are counted by login *and* by
source address in a limiter separate from the org rate limiter, since an unauthenticated attempt
has no org and would otherwise share one bucket with every anonymous request in the deployment;
the check runs before any password work, so a flood cannot turn the route into a CPU sink.

`POST /v1/auth/github/link { code }` is the other half: a signed-in local user runs the OAuth
flow from inside the dashboard and the resulting grant is filed under **their existing account
id**, not the GitHub user id — filed the other way, the link would appear to succeed and change
nothing, since `scopeFor` looks grants up by the session's id. The session token is not
re-issued: they stay signed in as who they were, and what changes is which orgs `switchOrg` will
let them into. The account to link comes from the bearer token, never from the body. The web
flow marks the round trip by prefixing the OAuth `state` with `link-`, read back off the
*cookie's* copy after the constant-time comparison rather than from the returned parameter.
Pinned by `apps/api/test/password-signin.test.ts`.

Still outstanding: the `users`/`memberships` tables in `db/schema.ts` remain unwritten. Tenancy
and membership are now derived from GitHub and cached in `user_access_grants` instead, which is
deliberate — a membership row would be a second source of truth for a question GitHub already
answers, and the one that goes stale.
