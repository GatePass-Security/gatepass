# Gatepass — Engineering Handoff

> **Read this first.** It is the complete context for continuing Gatepass. It assumes no prior
> knowledge of the conversation that produced this repo. Everything you need — what the product
> is, how it was built, what's done vs. deferred, how to run it, and exactly how to continue —
> is here or linked from here.

---

## 1. What Gatepass is (in one paragraph)

Gatepass is a **precision application-security platform for the AI-native stack**. It scans two
attack surfaces that legacy AppSec tools miss: **AI-generated application code** and **agentic
infrastructure** (MCP servers, tool definitions, permission scopes, autonomous loops). It
produces **two honestly-separated tiers** of findings — *verified* (deterministic, each shipped
with a runnable reproduction) and *research-tier* (semantic/agentic classes, confidence-scored,
never inflated) — and delivers fixes **inside the developer's own workflow** (PR comments, IDE,
opt-in coding-agent guidance) while **never mutating customer code or CI**. Its brand is
**measured precision**: a public benchmark of true/false-positive rates vs. incumbent scanners.
The full product thesis is in [GATEPASS_ONEPAGER_V4.md](GATEPASS_ONEPAGER_V4.md).

**The moat** = the agentic vulnerability-research corpus + the public precision benchmark +
**cross-surface analysis** (findings that only appear when you read app code *and* agent config
together, e.g. a scoped-looking tool backed by an unscoped DB client).

## 2. The governing law: the Constitution

`.specify/memory/constitution.md` (v1.0.0) is **non-negotiable**. Every change must honor it.
The six principles, in one line each:

1. **Precision Is the Product** — every rule ships with measured TP/FP; published-benchmark
   regressions block releases; no unmeasured precision claims.
2. **Two-Tier Finding Integrity** — *verified* requires a concrete reproduction; *research* is
   confidence-scored; the boundary is never blurred; **no third state**.
3. **Remediation in the Developer's Workflow** — suggest-and-approve only; **no silent
   mutation of code or CI**; the CI gate blocks but never rewrites; agent-loop guidance is opt-in.
4. **Cross-Surface Context** — app code + agent config analyzed together; framework-aware.
5. **Research-Fed Corpus** — new vuln classes follow definition → corpus → analyzer →
   measurement, against a versioned corpus.
6. **Pure Software; Evidence Is a Feature** — no services tier; compliance is limited to
   posture-derived evidence export + questionnaire drafting.

These are enforced *in code*, not just prose: the findings schema makes tier integrity a
validation invariant; the GitHub client interface has **no** code-write method; the corpus
harness fails CI if any rule lacks fixtures or any reproduction is non-confirmable; and Gatepass
**scans its own source** in CI (`.github/workflows/self-scan.yml`).

## 3. How this repo was built: the Spec-Kit workflow

This project was built with **GitHub Spec-Kit** (`/speckit-*` slash commands). The workflow and
its artifacts (all in [`specs/001-gatepass-platform/`](specs/001-gatepass-platform/)):

| Command | Produces | File |
|---|---|---|
| `/speckit-constitution` | Project principles | [`.specify/memory/constitution.md`](.specify/memory/constitution.md) |
| `/speckit-specify` | Feature spec (FR/SC/user-stories) | [`spec.md`](specs/001-gatepass-platform/spec.md) |
| `/speckit-clarify` | Resolves ambiguities into the spec | (Clarifications section in spec.md) |
| `/speckit-plan` | Architecture + design | [`plan.md`](specs/001-gatepass-platform/plan.md), [`research.md`](specs/001-gatepass-platform/research.md), [`data-model.md`](specs/001-gatepass-platform/data-model.md), [`contracts/`](specs/001-gatepass-platform/contracts/) |
| `/speckit-tasks` | Dependency-ordered task list | [`tasks.md`](specs/001-gatepass-platform/tasks.md) |
| `/speckit-analyze` | Cross-artifact consistency check | (report only) |
| `/speckit-implement` | Executes tasks, marks them `[X]` | code + [`validation/`](specs/001-gatepass-platform/validation/) |
| `/speckit-converge` | Assesses code vs. intent, appends remaining work as tasks | (appends Phase N to tasks.md) |

**The commands are vendored into this repo** at [`.claude/skills/`](.claude/skills/) with helper
scripts at [`.specify/scripts/`](.specify/scripts/), so you can run them directly — see §7.

## 4. Repository tour

pnpm + TypeScript monorepo (ESM, NodeNext). One **deterministic analysis engine** is embedded
identically by the hosted workers, the CLI, and the self-hosted runner — this is what makes
hosted/runner finding parity structural, not aspirational.

```
packages/
├── findings/       Canonical findings schema + TIER-INTEGRITY validation + SARIF + redaction linter
├── rules-registry/ Vulnerability-class lifecycle (can't activate without corpus + measured precision)
├── engine/         Scan context, file ingestion, multi-surface classification, framework detection
├── detectors/      9 detectors + cross-surface correlation + fix generation + the scan pipeline
├── semantic/       LLM gateway (zero-retention, offline fallback) + analyzeSemantic refinement
├── github/         CI-gate decision, PR review builder, audited Remediator, RestGitHubClient
├── evidence/       SOC2/ISO control map, posture eval, questionnaire drafting + CSV/SIG-lite/XLSX ingest
└── shared/         plan-tier gating, audited writer, config, disclosure FSM, crypto, telemetry, retention
apps/
├── api/            Runnable HTTP API wiring everything (in-memory store; swap for Postgres)
├── web/            Next.js 15 App Router dashboard — 8 pages (findings, fleet, benchmark, compliance, settings, agent-guidance, onboarding, root) consuming the API; Tailwind v4, 9 UI primitives, typed API client
└── workers/        In-process scan orchestrator (queue/concurrency/retries/timeouts/timings)
cli/                `gatepass scan <path>` — the OSS scanner (free tier)
runner/             Self-hosted runner protocol (findings-only uploads, version-floor handshake, parity)
benchmark/          TP/FP scoring, precision-regression detection, release gate
corpus/             Versioned labeled fixtures (12 classes) + harness + eval repo
.github/workflows/  CI (test + corpus gate), self-scan, release precision gate, monthly benchmark
```

**The 9 detectors** (`packages/detectors/src/`):
- *Verified* (deterministic, with reproductions): `exposed-secret`, `unauth-mcp-transport`,
  `rls-gap`, `cors`, `unpinned-dependency`, `unbounded-tool-param`, `missing-schema-validation`.
- *Research* (confidence-scored): `tool-poisoning`, `cross-surface-scope-mismatch`, `hbv`
  (hallucination-based vuln), `confused-deputy`, `over-permissioned-loop`.

## 5. Current status (as of this handoff)

**Everything below was executed and verified — nothing is claimed done without evidence.**
Full accounting: [`validation/build-status.md`](specs/001-gatepass-platform/validation/build-status.md).

- **358 tests pass** across 35 files — `pnpm test`
- **All packages typecheck clean** — `tsc --noEmit`
- **Lint 0 errors / format clean** — `pnpm lint`, `pnpm format:check`
- **Corpus gate PASS** — 12 classes, **100% TP / 0% FP**, all reproductions confirmable — `pnpm corpus:measure`
- **Self-scan CLEAN** — the scanner passes its own scan
- **API integration** — a real HTTP server is driven through scan → findings → SARIF → gate →
  dispute → suppression → agent-guidance → fleet → benchmark → runner-upload → evidence → 403

**Task ledger: 47 done · 19 partial · 39 open** (see [`tasks.md`](specs/001-gatepass-platform/tasks.md);
markers: `[X]` complete+verified, `[~]` partial with an inline note on what's deferred, `[ ]` not started).

### What is genuinely complete
The entire **analysis core and platform logic** — the actual product and its moat. Detection,
cross-surface correlation, two-tier integrity, remediation decision logic, CI-gate logic,
evidence/questionnaire logic, runner protocol, orchestrator, benchmark scoring, the LLM-gateway
wiring, and the full API surface are built, tested, and lint-clean.

The **Next.js dashboard** (`apps/web/`) is also built — 8 pages consuming the API (findings,
fleet, benchmark, compliance, settings, agent-guidance, onboarding, root), 9 custom UI
primitives (Tailwind v4), typed API client with 10s timeout for all requests, error/loading
boundary on every route, sidebar navigation, org context, theme toggle. Build passes, lint clean.

### What is deferred and WHY (this is the important part)
Everything remaining needs **live infrastructure or credentials that did not exist in the build
environment**. It was left deliberately unbuilt rather than written as untested stubs (which
would violate honesty and the Constitution's "measured" ethos). Precise blockers:

| You must provide | Unblocks (tasks) | What to do |
|---|---|---|
| A running **Postgres 16** | T005/T006 (run migrations), T077 (replace in-memory store) | `docker compose up -d postgres`, then run the SQL in `packages/shared/db/migrations/`, then swap `apps/api/src/store.ts` for a Drizzle-backed repo |
| A **GitHub App** install + token | T016/T072 (webhooks), T073/T074/T096 (actually post), T076 (OAuth/RBAC) | Create a GitHub App (scopes: contents:read, pull_requests:write, checks:write, metadata:read — see `contracts/github-integration.md`); construct `RestGitHubClient` with the installation token |
| An **NVIDIA NIM API key** (`NVIDIA_API_KEY`, model `z-ai/glm-5.2`) | Live research-tier LLM refinement | Set `NVIDIA_API_KEY` in `.env`; `apps/api` wires `createNimTransport` automatically. Benchmarks: `pnpm benchmark:with-llm` |
| **Vanta/Drata** sandbox + API key | T083 (evidence push) | Implement exporters posting `evaluatePosture()` items to their evidence APIs |
| A **cloud deploy target** (ECS/RDS/S3/Redis) | T015/T015a/T086 (isolation/encryption IaC), T063/T092 (SLO/status), T091 (load) | Write IaC (Terraform); wire OTel exporter into the `telemetry.ts` `setTracer()` seam |
| (optional) build tooling | T098 (tree-sitter AST) | Precision refinement of already-passing detectors — low priority |

### Unbacked product claims in the dashboard copy — DECIDE BEFORE LAUNCH

The dashboard ships marketing copy that asserts service levels nothing in this repo delivers.
This is flagged rather than silently rewritten because they are **product commitments, not
code**: only the founder can decide whether to honour them or cut them. Left as-is, they are
the same category of defect the Constitution's "measured precision" principle exists to
prevent — a claim a reader can check and find hollow.

| Where | Claim | Status |
|---|---|---|
| `apps/web/src/app/support/page.tsx` | "Enterprise tier customers get priority support with a dedicated engineer and **guaranteed 4-hour response time**" | Nothing backs it. Renders identically for a `free`-tier org — `OrgRecord.planTier` is available but never consulted. |
| `apps/web/src/app/support/page.tsx` | "Send a detailed ticket and we'll **respond within 24 hours**" | No ticketing system or SLA exists. |
| `apps/web/src/app/support/page.tsx` | "Chat with our support team in **real-time during business hours**" | No chat integration exists. The button is disabled and labelled "Not connected yet", but the sentence still promises the channel. |

Each option is fine; pick one per row: **honour it** (staff it, and gate the enterprise row on
`planTier`), **soften it** (drop "guaranteed", give a range instead of an SLA), or **cut it**
(remove the card until the channel exists).

## 6. Recurring gotchas (learn from the bugs already fixed)

Three real precision bugs were found (by the corpus gate + self-scan) and fixed. They share a
pattern worth internalizing:

1. **Comment-vs-code false positives.** Detectors that scan raw source (`cors`, `unauth-mcp`,
   `cross-surface`, `over-permissioned-loop`) must **ignore comment lines** — a comment that
   says "no row-level security" or shows an example `Access-Control-Allow-Origin: *` is not a
   vulnerability. Every such detector strips comments before matching. Do the same for new ones.
2. **Over-broad surface classification.** A file named `server.ts` is **not** an MCP server just
   because of its name — `mcp_server` surface requires an `mcp/`/`agent/` directory or an
   `mcp*`-prefixed filename (see `packages/engine/src/surfaces.ts`). This caught our own API.
3. **Heuristics keying off variable *names*.** Detect *behavior* (inbound auth read + outbound
   auth header), not a specific identifier spelling.

**Because of #1/#2, the scanner passes its own self-scan.** If you add a detector, add corpus
fixtures (vuln + clean) FIRST, run `pnpm corpus:measure` (must stay 100% TP / 0% FP), then run
the self-scan loop in `.github/workflows/self-scan.yml` to confirm you didn't flag Gatepass itself.

Other environment notes:
- **Windows dev box**: git warns LF→CRLF on commit — harmless. Node 22+, pnpm 9. Docker Desktop
  must be running for the Postgres/Redis compose services.
- **The pipeline is deterministic** — same (ruleset, inputs) ⇒ byte-identical fingerprints. This
  underpins hosted/runner parity (a test asserts it). Don't introduce nondeterminism (Date.now,
  Math.random) into finding generation.
- **The async LLM path (`runScanAsync`)** only refines *research-tier* confidence and re-validates
  through the schema; verified findings and determinism of the verified set are untouched.

## 7. How to run everything

```bash
# 0. Prereqs: Node >=22, pnpm 9 (npm i -g pnpm@9), Docker Desktop (for Postgres/Redis)
pnpm install

# 1. The full verification gate (what CI runs)
pnpm test                         # 358 tests
pnpm lint                         # ESLint (0 errors)
pnpm format:check                 # Prettier
pnpm corpus:measure --corpus corpus-v1   # precision + reproduction gate (must PASS)

# 2. Scan something (the OSS CLI)
pnpm scan corpus/eval-repos/vulnerable-nextjs-mcp          # human output
pnpm scan <path> --json --output findings.json            # machine output
pnpm scan <path> --fail-on verified                       # CI-gate style exit code

# 3. Self-scan (scanner passes its own scan — verified findings block)
for d in packages/*/src cli/src runner/src benchmark/src apps/*/src; do pnpm scan "$d" --fail-on verified; done

# 4. Run the API (in-memory store; seeds a demo org)
pnpm --filter @gatepass/api start     # http://localhost:3000
#   POST /v1/orgs/demo/scans {"path":"<abs path>"}  → scanId
#   GET  /v1/scans/:id/findings ; /findings.sarif
#   POST /v1/scans/:id/gate ; /v1/findings/:fp/dispute ; GET /v1/orgs/demo/evidence?scanId=
#   Full route list: specs/001-gatepass-platform/contracts/api.md
```

### Continuing with Spec-Kit (the intended workflow)
The `/speckit-*` commands are vendored in `.claude/skills/`. In Claude Code, run them by name.
The recommended loop to keep closing the gap to "done":

```
/speckit-converge     # assess code vs spec/plan/tasks; append any remaining work as tasks
/speckit-implement    # execute the open tasks it can; marks [X]; re-run tests/corpus/self-scan
```
Repeat. Each converge pass finds fewer gaps. When it reports "✅ Converged," the specified scope
is done. The helper scripts (`.specify/scripts/`) resolve the active feature automatically from
`.specify/feature.json`.

**To change scope**: edit `spec.md` (or run `/speckit-specify` for a new feature), then
`/speckit-plan` → `/speckit-tasks` → `/speckit-implement`. If you change a Constitution principle,
do it via `/speckit-constitution` (it version-bumps and propagates to templates).

## 8. Non-negotiable rules for anyone (human or AI) touching this code

Mirrors [`CLAUDE.md`](CLAUDE.md), repeated here because they are load-bearing:

1. Findings `tier` is a closed enum; `verified` ⇒ reproduction present (enforced by schema in
   `packages/findings` **and** the DB CHECK in `0002_findings.sql`). Never bypass.
2. **No code path may write to customer repositories or CI config.** All outbound writes go
   through the audited writer (`AuditedWriter` → `AuditEvent`). The `GitHubClient` interface has
   no write-code method — keep it that way.
3. Every rule/analyzer change ships corpus fixtures + a precision measurement, or it does not merge.
4. The CI gate fails **open** by default (neutral check + annotation); fail-closed is per-repo opt-in.
5. The runner uploads findings/posture JSON **only** — the schema must never grow a field that
   can carry source code (there's a test that rejects one).
6. Research-tier findings always show confidence; never present them with verified-tier certainty.
7. Evidence/questionnaire outputs derive from real scan posture — never fabricated (there's a test).

## 9. Commit history (what each step did)

```
264628f  Bootstrap Gatepass MVP scanner core (spec-kit feature 001)
7ebbfb8  Build out full scanner platform: 9 detectors, correlation, remediation, evidence, runner, API
2035932  Converge: append Phase 9 (T071-T094) for remaining requirement-level gaps
81b4fbe  Implement Phase 9 convergence tasks (offline-testable subset)
41c3d19  Converge (2nd pass): append Phase 10 (T095-T100) for partial-remainders
e5d3396  Implement all offline-completable convergence work (Phase 9/10 subset)
+ (current) Confidence calibration (T028), 227 new tests, coverage config, deep-import cleanup
```

## 10. Founder / project context (was previously only in the AI's working memory)

- The founder is **CTO-level**, builds MCP servers and agent systems professionally at
  ZiliconCloud, and has done SOC 2 / SOC-pipeline work — Gatepass is the intersection of both.
  The founder ships daily with AI coding tools. Handoff is to a **cofounder** continuing the build.
- **Working style that was applied throughout and should continue**: brutal honesty about what is
  built vs. stubbed; nothing marked done without executed evidence; deferred work is labeled with
  the exact blocker, not hidden. The Constitution's "measured precision" ethos applies to the
  engineering process itself.
- The build was done on Windows with no live cloud/GitHub/DB/LLM credentials, which is exactly why
  the deferred set in §5 exists. The *first* thing to do with real infra is wire and **verify**
  those slices end-to-end (don't trust the interface code until it's run against the real service).

---

*This document, the spec-kit artifacts under `specs/001-gatepass-platform/`, the vendored
`/speckit-*` commands, and the passing test/corpus/self-scan gates together are the complete
handoff. Start at §7, run the gate, then `/speckit-converge`.*
