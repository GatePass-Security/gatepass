# Corpus integrity log

This file records everything that could bias a number measured on this corpus. It exists because
the previous corpus produced a 100% score that meant nothing, and the only defence against that
happening again is writing down what was done to the measurement set and when.

If you are reviewing a published Gatepass benchmark figure, read this first.

## How the corpus is built

- 12 vulnerability classes, 10 cases each: 5 vulnerable, 5 clean. 120 total.
- The 5 clean cases per class are **hard negatives** — code that superficially resembles the
  vulnerability and is designed to defeat a naive pattern matcher (a `.env.example` template, a
  redaction unit test full of credential-shaped strings, constraints hidden behind a `$ref`, a
  global lookup table that legitimately needs no row-level security).
- The 96 cases added in corpus-v2 were written by four agents that were **prohibited from reading
  `packages/detectors/` or `packages/engine/`**, and were instructed to work from the vulnerability
  definition alone. They were explicitly told that fixtures which defeat the scanner are a
  desirable outcome. Several of them do.

## How the split works

`SPLIT.json` divides the corpus into `dev` (72) and `holdout` (48). The holdout is stratified by
(class, label), so it contains all 12 classes and an even 24 vulnerable / 24 clean.

Membership is a deterministic FNV-1a hash of the case id, not a random draw, so the split is
reproducible on any machine and cannot be quietly reshuffled into a more flattering partition.

**Detector work may read `dev`. Reading `holdout` while tuning invalidates the held-out number.**
`benchmark/src/full-matrix.ts` takes `--dev` and `--holdout` so a developer never has to see the
holdout to check their work.

## Baseline, recorded before any detector work

Measured on corpus-v2 immediately after the corpus was authored and before a single detector was
changed. Saved to `benchmark/reports/holdout-baseline.json`.

| Set | Detection | Same-class FP |
|---|---|---|
| dev (72) | 8/36 — 22.2% | 1/36 — 2.8% |
| holdout (48) | 8/24 — 33.3% | 5/24 — 20.8% |

The corpus-v1 figure this replaced was 12/12 detection and 0% false positives, across 24 cases
that were written alongside the detectors that catch them.

## Incidents

### 2026-07-28 — cors-misconfig holdout exposed during detector work

**What happened.** An agent tasked with generalising `cors.ts`, `dependencies.ts` and
`exposed-secret.ts` listed fixture files with `find` from the `cors-misconfig` class root rather
than iterating its six assigned dev directories. The output included all four cors-misconfig
holdout cases:

- `verified/cors-misconfig/clean-cors-regression-test`
- `verified/cors-misconfig/clean-fastify-public-readonly-wildcard`
- `verified/cors-misconfig/vuln-go-assembled-wildcard`
- `verified/cors-misconfig/vuln-nginx-reflected-origin`

The agent detected and disclosed this itself, and switched to explicit per-directory reads for the
other two classes, which are uncontaminated. The remaining 44 holdout cases were never read.

**Contributing error on the requester's side.** Case lists in the detector briefs were
hand-transcribed rather than generated from `SPLIT.json`. Three holdout cases were mislabelled as
dev across two briefs — `exposed-secret/vuln-aws-in-bundle`, `unpinned-dependency/vuln-star-range`
and `cross-surface-scope-mismatch/vuln-scoped-tool-unscoped-client`. In every instance the agent
noticed the conflict, followed `SPLIT.json` over its instructions, and did not open the case. The
lesson is mechanical, not moral: generate case lists from the split file, never retype them.

**Resolution.** The four exposed cases are **retired from the holdout** and remain in the corpus
for regression purposes only. A replacement set (`holdout2-*`, 3 vulnerable + 3 clean) was authored
by a fresh agent barred from reading both the detector source and every pre-existing
cors-misconfig fixture. Any published held-out figure uses the replacement set for this class.

**Assessment.** The exposure is real and is why this entry exists. Two facts bound its impact,
neither of which makes it acceptable: the four shapes involved (nginx origin reflection, a Go
wildcard reached through a variable, regression-test files containing wildcard literals, and a
credential-free public wildcard) were all named in the agent's brief before it read anything, and
no rule keyed to those specific files was added. The honest position is that the cors-misconfig
holdout score was compromised, so it was replaced rather than argued for.

### 2026-07-28 — unbounded-tool-param holdout exposed, same cause

A second detector agent made the identical mistake: an exploratory `find`/`cat` rooted at the
`unbounded-tool-param` class directory rather than at its six assigned dev cases. It dumped all
four holdout cases for that class (`clean-bounded`, `clean-enum-constrained-action`,
`vuln-freeform-command-string`, `vuln-unbounded-array-and-object`), disclosed it unprompted, and
worked per-case afterwards. The `missing-schema-validation` and `rls-gap` holdouts it also owned
were never touched.

**Resolution.** Same as above: those four are retired from the holdout, and a `holdout2-*`
replacement set was authored by a fresh agent barred from the detector source and from every
pre-existing fixture in that class.

**Root cause, and the fix.** Two independent agents leaked the same way, which makes this a
process defect rather than two mistakes. Listing a class directory is the obvious first move when
you are handed a class to work on, and nothing prevented it. Later briefs add an explicit
prohibition on `find`/`ls -R`/`cat` rooted at a class directory. A durable fix would be to
physically separate the holdout — a sibling tree the working set does not contain — so the rule is
enforced by the filesystem instead of by instruction.

### 2026-07-28 — names-only listing during clean-room authoring

An agent writing the `holdout3-` clean-room set ran one `find` rooted at `corpus/cases/research`
while verifying its own output. It returned directory and file *names* only; no pre-existing case
contents were opened, and the agent disclosed it unprompted.

**Assessment: minor, recorded rather than remediated.** Case directory names are descriptive
(`vuln-zero-width-obfuscated-desc`, `vuln-self-requeue-worker`), so a listing carries some signal
about which shapes already exist. Against that: the sixteen cases this agent produced overlap none
of the shapes visible in those names, and a name conveys far less than a fixture. The set is
retained. A reader who disagrees can discount that agent's four classes and read the other eight.

The recurrence of this specific failure across three separate agents is the argument for moving the
evaluation cases out of the working tree entirely, rather than for writing a stricter prohibition.

### 2026-07-28 — names-only listing via `git status`, and an informed engine change

A capability agent, which never read `corpus/` and ran no listing rooted there, ended its session
with `git status --porcelain` to confirm its edits were confined to its two allowed files. That
printed untracked **directory names** under `corpus/cases/`, including evaluation ones. Names only,
no contents, and all implementation was complete before the command ran.

Separately and more materially: that agent reported that `.cs`, `.kt` and `.properties` were
missing from the engine's scannable extensions, so C# and Kotlin services could not be analysed at
all. The extensions were added. **At the time of that change the orchestrator knew, from a fixture
author's report, that the clean-room set contains a C# case.** The change stands on its own merits
— a scanner that cannot open C# is not exercising judgement, it is blind — but it was not made in
ignorance. Note that making a file readable is not the same as detecting anything in it: C#-specific
CORS analysis was explicitly out of scope for that agent, so the case may well still be missed.

Three separate agents have now leaked directory names by three different routes (`find`, `ls -R`,
`git status`). No prohibition survives contact with a working tree that contains the answers. The
fix is structural: move evaluation cases to a sibling tree the working set does not contain.

## Why a dev score is not evidence

During the corpus-v2 detector work one agent wrote 19 synthetic probes from the *written
description* of each vulnerability shape rather than from any fixture, and ran them against its
own freshly-passing detectors. **Four failed while the dev set read 9/9.** Among them:

- a secret-bearing constant named exactly `KEY`, rejected because a regex required 4+ characters
- a file whose only HTTP client was imported from another module, gated out before analysis ran
- an allow-list named `permittedHosts`, missed because the *mitigation* pattern was itself overfit
  to the identifier `ALLOWED_HOSTS`
- an MCP `readOnlyHint` extractor that read a TypeScript parameter type annotation instead of the
  function body, which meant that entire detection path was dead code and the fixture it was
  supposed to catch had been passing through an unrelated rule

This is the clearest available demonstration that a perfect score on cases you can see says
nothing about generalisation. It is the argument for the holdout, and for keeping an independent
probe set alongside the corpus.

## Known limits of any score measured here

- The corpus is authored, not harvested. It is adversarial and independently written, but it is
  not a sample of real-world code. The third-party check on that is the public MCP server survey.
- Whether a credential is live, whether an endpoint is genuinely internet-facing, and whether a
  version tag is immutable are not decidable from source. Detectors approximate these, and the
  approximations are wrong at the edges.
