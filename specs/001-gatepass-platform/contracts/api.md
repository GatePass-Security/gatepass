# Contract: Platform API (REST, `/v1`)

Auth: session (dashboard) or org-scoped API keys; runner endpoints use runner tokens.
All responses JSON; errors RFC 7807. RBAC: viewer=read, member=read+dispute+scan,
admin=settings+tokens+exports.

## Orgs, repos, settings

| Method & Path | Purpose | Notes |
|---|---|---|
| GET /orgs/:org | Org profile, plan tier | |
| GET /orgs/:org/repos | Connected repos + scan settings | mirrors GitHub visibility (FR-027) |
| PATCH /orgs/:org/repos/:repo | Set gate_mode, gate_failure_mode, agent_loop_enabled | admin; FR-014/016/016a |
| PATCH /orgs/:org/settings | llm_analysis_enabled etc. | admin; FR-011a |

## Scans & findings

| Method & Path | Purpose | Notes |
|---|---|---|
| POST /orgs/:org/repos/:repo/scans | Trigger on-demand scan | FR-006 |
| GET /scans/:id | Status + stage timings | |
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

`PATCH /orgs/:org/repos/:repo` (no per-repo settings storage — `listRepos` returns
`gate_mode: "off"` / `gate_failure_mode: "fail_open"` for every repo), `GET /scans/:id`,
`GET /orgs/:org/questionnaires/:id`, `GET /public/reports/:slug`.

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

**RBAC is still not enforced.** The `admin`/`member`/`viewer` roles above are unimplemented and
the router applies no per-role authorization to any other route; `authCallback` hardcodes
`role: "member"` (`apps/api/src/handlers.ts`). Rate-limit bucketing also trusts a caller-supplied
`X-Org-Id` header, so an unauthenticated caller can mint a fresh bucket. Resolve before
multi-tenant traffic.
