# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `specs/[###-feature-name]/spec.md`

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

**Language/Version**: [e.g., TypeScript 5.x / Python 3.12 / Go 1.23 or NEEDS CLARIFICATION]
**Primary Dependencies**: [frameworks, analyzers, or NEEDS CLARIFICATION]
**Storage**: [if applicable, e.g., Postgres, files, N/A]
**Testing**: [e.g., vitest, pytest, go test, plus corpus fixtures]
**Target Platform**: [e.g., CLI, CI runner, web service]
**Project Type**: [single/web/cli — determines source structure]
**Performance Goals**: [domain-specific, e.g., full-repo scan < N min]
**Constraints**: [domain-specific, e.g., no network egress during scan]
**Scale/Scope**: [domain-specific, e.g., corpus size, repos per org]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.
Source: `.specify/memory/constitution.md` v1.1.0*

| Gate | Principle | Pass? |
|------|-----------|-------|
| Any new/changed rule has corpus fixtures and a measured TP/FP plan; no published-precision regression | I. Precision Is the Product | [ ] |
| Verified findings ship with deterministic reproduction; research-tier findings are confidence-scored, never inflated; tier boundary unblurred | II. Two-Tier Finding Integrity | [ ] |
| No silent mutation of customer code/CI; remediation is suggest-and-approve; CI gate blocks but never rewrites; agent-loop guidance opt-in; any repository write is the bounded suggested-fix-PR carve-out only — explicit human trigger, opted-in org, new non-default branch, never CI config, always audited, never auto-merged | III. Workflow Remediation | [ ] |
| Surfaces read are declared; design preserves cross-surface correlation; framework-aware where applicable | IV. Cross-Surface Context | [ ] |
| New vulnerability classes follow definition → corpus → rule → measurement order; corpus versioned | V. Research-Fed Corpus | [ ] |
| No services-tier scope; compliance limited to evidence export/questionnaire drafting from real scan posture | VI. Pure Software / Evidence as Feature | [ ] |
| Customer code least-privilege, not retained beyond need, never used for training without opt-in | Security & Trust Constraints | [ ] |

Violations MUST be justified in Complexity Tracking or the design reworked.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
[Define the concrete layout for this feature; delete unused options]
src/
tests/
corpus/                  # versioned rule fixtures, if rules are touched
```

**Structure Decision**: [Document the selected structure]

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| [e.g., new analysis pass] | [current need] | [why insufficient] |
