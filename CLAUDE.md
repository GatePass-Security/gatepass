# Gatepass — Agent Context

Precision AppSec platform for the AI-native stack: scans AI-generated app code and agentic
infrastructure (MCP servers, tool definitions, permission scopes) with two-tier findings,
developer-workflow remediation, a public precision benchmark, and compliance evidence export.

> **Taking over / need full context? Read [HANDOFF.md](HANDOFF.md).** It has the complete
> picture: what's built vs. deferred (and why), how to run everything, the recurring bug
> patterns, and how to continue with the vendored `/speckit-*` commands.

## Governance

- **Constitution**: `.specify/memory/constitution.md` (v1.1.0) — six principles are
  non-negotiable: precision measured & published; verified findings require reproductions; no
  silent repo/CI mutation (bounded, audited suggested-fix-PR carve-out only); cross-surface
  analysis; research-fed versioned corpus; pure software (no services tier). Read it before
  designing anything.
- **Active feature**: `specs/001-gatepass-platform/` (spec.md → plan.md → research.md,
  data-model.md, contracts/, quickstart.md). `.specify/feature.json` points here.

## Stack (decided in plan phase — see specs/001-gatepass-platform/research.md)

- TypeScript 5.x / Node 22, pnpm + Turborepo monorepo
- Analysis engine: tree-sitter parsing (TS/JS, Python, Go, SQL) + config parsers;
  `packages/engine` + `packages/detectors` are pure libraries embedded identically by hosted
  workers, OSS CLI, and self-hosted runner (finding parity is by construction)
- Research-tier semantic analysis: NVIDIA NIM GLM 5.2 (`z-ai/glm-5.2`) via Gatepass
  gateway (`createNimTransport`), `NVIDIA_API_KEY`, per-org disable flag
- Platform: Fastify API, Next.js dashboard, PostgreSQL 16 (Drizzle, org RLS), Redis/BullMQ,
  S3 artifacts with TTL; per-scan container isolation (ECS Fargate)
- GitHub App: contents:read, pull_requests:write, checks:write, contents:write — contents:write
  is used only by the opt-in fix-PR path (human-triggered, new branch, never CI config).
  The App is also the **identity provider**: sign-in uses its user-to-server tokens, which is
  what makes `GET /user/installations{/:id/repositories}` available and therefore what makes
  per-repository access possible at all (a classic OAuth App cannot call those).
- Access control is GitHub's answer, not a list Gatepass keeps (`packages/github/src/access.ts`,
  `apps/api/src/access.ts`). A tenant **is** a GitHub org that installed the App; the people who
  may use Gatepass for a repository are exactly the people GitHub says may work on it; grants
  are cached with a short TTL and re-derived, never edited.
- Corpus in `corpus/` with immutable tags; benchmark harness in `benchmark/`

## Hard rules for code in this repo

1. Findings tier is a closed enum; `verified` ⇒ reproduction present (DB CHECK + schema
   validation in `packages/findings`). Never bypass.
2. CI configuration is never written, ever. Repository writes are permitted only via the
   audited fix-PR path (`packages/github/src/fix-pr.ts`): human-triggered dashboard action on
   an opted-in org, always a new branch (never default, never force-push), never `.github/**`.
   All outbound writes go through the audited writer (AuditEvent).
3. Every rule/analyzer change ships corpus fixtures + precision measurement or it does not
   merge.
4. CI gate fails open by default (neutral check + annotation); fail-closed is per-repo
   opt-in.
5. Runner uploads findings/posture JSON only — the schema must never grow a field that can
   carry source code.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
