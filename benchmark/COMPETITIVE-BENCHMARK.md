# Gatepass competitive benchmark

**Corpus v2 · 192 cases · measured 2026-07-28**

Every figure here is reproducible from this repository, and the command that produces it is given
beside the claim. Where a number is unflattering it is printed anyway, because the entire point of
this document is that you can check it.

Supersedes the report of earlier the same day, which measured 180 cases at 74.4% detection.
Section 2 explains what changed and — more importantly — what that improvement is and is not
evidence of.

---

## The short version

Gatepass detects twelve agentic vulnerability classes that no other scanner detects at all, at
**92 of 93 vulnerable cases with zero false positives across 99 clean ones**.

**Every one of those 192 cases was available during detector development.** There is no held-out
population left in this corpus. That figure is therefore an upper bound on a customer's repository,
not a prediction of it. Section 2 is the part to read before quoting any of this.

---

## 1. What the corpus is

192 cases across 12 vulnerability classes. Each class carries vulnerable fixtures and a matching
set of **hard negatives** — safe code written specifically to fool a pattern matcher: a
`.env.example` template full of credential-shaped strings, a redaction unit test asserting that
secrets get masked, a CORS regression test whose *title* is a sentence about wildcards, an nginx
`map` block that is an exact allowlist, a global lookup table that legitimately needs no
row-level security.

Most cases were authored by agents forbidden from reading `packages/detectors/` or
`packages/engine/`, working from the vulnerability definition alone, and told explicitly that
fixtures which defeat the scanner are a desirable outcome. Many of them did.

Languages and formats represented: TypeScript, JavaScript, Python, Go, Rust, Ruby, Java, C#, PHP,
SQL, HCL and Terraform state, protobuf, GraphQL SDL, OpenAPI, nginx, Envoy, Kubernetes, Docker,
GitHub Actions, Chrome extension manifests, Jupyter notebooks, lockfiles.

## 2. The number is 98.9%, and here is exactly what it means

| Population | Cases | Detection | Same-class FP |
|---|---|---|---|
| Full corpus | 192 | 92/93 — **98.9%** | 0/99 — **0.0%** |
| Clean-room subset | 48 | 24/24 — 100% | 0/24 — 0.0% |

Earlier versions of this document presented three populations — full, held out, clean room — and
argued that the clean-room figure was the one that predicted a customer's repository. That
argument was correct, and it no longer applies here.

**The detectors were subsequently developed with access to all 192 cases, including the clean-room
set.** The clean-room row above is not an independent measurement any more; it is a measurement of
whether the detectors recognise fixtures they were tuned against. It is reported for completeness
and should carry no evidential weight whatsoever.

This is the same shape of mistake corpus v1 made when it reported 100% on 24 cases written
alongside the detectors that caught them. It is stated here rather than discovered later.

### So what *is* the improvement evidence of?

Detection moved from 67/93 to 92/93. Reading the changes rather than the score, the work divides
in two, and only one half generalises.

Genuinely general capability was added. The engine could not open `.rs`, `.csproj`, `.sh`,
`.proto`, `.graphql`, `.html`, `.ipynb` or `.tfstate` at all — a scanner that cannot read a file
is not choosing not to report, it is unable to look, and two exposed-secret cases were unreachable
for that reason alone. New language front-ends landed for PHP, Java, Ruby and Rust. Several rules
were rewritten around the property rather than the syntax: self-recursion is now treated as an
iteration construct in *every* language, not just Rust; a countdown is recognised as the same bound
as a count-up; an nginx `map` is constant-folded the way JS and Spring config already were; a
credential written inside one call's argument list is attributed to that call rather than to its
neighbour.

Three rules got *narrower*, and those are the precision result: an emptiness check (`if origin
!= ""`) is no longer read as an allowlist; a test's English title is no longer read as a policy;
and a bounded dependency range no longer produces a finding on the strength of an absent lockfile,
which had been firing on essentially every Node repository that ships without a committed one.

But the corpus was visible throughout. The honest summary is that the capabilities are real and the
*rate* is not transferable.

### What would make this number mean something again

A fourth clean-room set, authored against the class definitions by agents that have seen neither
the detector source nor any existing fixture, and that are not told which capabilities were just
built. Until that exists, 98.9% is an upper bound and this document says so wherever it appears.

## 3. Head to head

Same 192 cases, same scoring pipeline (`benchmark/src/score.ts`), every tool at a pinned version.
Incumbent rule ids are mapped onto Gatepass classes generously: any rule plausibly addressing a
class counts as detecting it.

| Tool | Classes with ≥1 detection | Vulnerable cases | False positives | Wall clock |
|---|---|---|---|---|
| **Gatepass** | **12 / 12** | 92/93 — 98.9% | 0 | 0.8 s |
| Semgrep 1.170.1 | 2 / 12 | 5/93 — 5.4% | 1 | 106 s |
| Gitleaks 8.30.1 | 1 / 12 | 2/93 — 2.2% | 1 | — |
| Trivy 0.72.0 | 0 / 12 | 0/93 | 0 | — |

Semgrep is the strongest incumbent and finds real bugs — a FastAPI wildcard-with-credentials, an
AWS key, a GCP service-account key. Most of its findings map to no Gatepass class at all: missing
Docker `USER`, TLS audit, dynamic urllib. It is a broader general-purpose tool that does not cover
the agentic classes. That is a difference in scope, not a defect.

**Two tools that used to appear in this table have been removed, and neither was removed for
scoring badly.**

*GitHub Advanced Security (CodeQL 2.26.1)* was published at 0/12. The harness invoked
`codeql database analyze <source-dir>`, which requires a CodeQL database rather than a source tree.
It aborted with `is not a recognized CodeQL database` on every single case, and the runner — which
discarded stderr and read a report file that was never written — recorded the absence as zero
findings. **CodeQL has never been measured here.** A 0/12 published against a mature commercial
SAST engine on the strength of a run that read no code is the worst thing this table is capable of
doing, and it did it until somebody typed the command by hand.

*CodeRabbit* was published at 2/12. It was never installed; the harness skipped it every run. The
`coderabbit` package on npm is a security holding placeholder containing no code.

### Greptile: attempted, unmeasured

`greptile review` is a diff reviewer for repositories it has indexed, identified by their git
remote. Corpus cases staged as local-only repositories have no remote, so the CLI declines before
reading any code. It returned that error for all 24 cases attempted, and the first version of the
harness recorded 24 empty reviews and scored it **0/12**.

No Greptile figure is published. Measuring it fairly would require hosting the fixtures on a
repository it can index, which is a different experiment.

### The measurement bugs, all four

| # | Symptom | Cause | Would have published |
|---|---|---|---|
| 1 | Semgrep 0/12 | Container-relative `/src` paths not attributed to cases | A falsehood about Semgrep |
| 2 | Semgrep 0/12 | `Detection` built with `classId` instead of `flaggedClassIds` | A falsehood about Semgrep |
| 3 | CodeQL 0/12 | `database analyze` on a source tree; stderr discarded; missing report read as empty | A falsehood about CodeQL |
| 4 | Greptile 0/12 | No git remote; non-zero exit parsed as "no comments" | A falsehood about Greptile |

Every one of these made a competitor look worse and Gatepass look better. None was caught by a
test; all four were caught by asking why a plausible tool had produced an implausible zero.

Both harnesses now refuse to express "did not run" as "found nothing": `run-incumbent.ts` returns a
skip carrying the tool's own error text, and `run-greptile.ts` aborts the entire run and writes no
report. `benchmark/src/publish-v2.ts` additionally refuses to place two tools in one table unless
their case counts match exactly — added after Semgrep's 180-case run was nearly published beside a
192-case Gatepass run under a single `corpus-v2` label.

## 4. Against a frontier LLM

A different population, and it must not be read against the table above. 24 cases — one vulnerable
and one clean per class — drawn from the clean-room set, which is what the LLM baseline was run on.
Published as `benchmark/published/corpus-v2-sample.json`.

| Tool | Classes | Recall | Precision | False positives |
|---|---|---|---|---|
| **Gatepass** | **12 / 12** | **12/12 — 100%** | **100%** | **0** |
| Claude — naive prompt | 12 / 12 | 12/12 — 100% | 60.0% | 8 |
| Claude — practitioner prompt | 11 / 12 | 11/12 — 91.7% | 68.8% | 5 |
| Claude — guided, given the class list | 12 / 12 | 12/12 — 100% | 100% | 0 |

The guided row is kept deliberately. Handed the twelve class ids and asked to pick from them, the
model matches Gatepass exactly. That is multiple-choice recall rather than detection, and it is the
condition under which an earlier version of this benchmark claimed a 12/12 tie — but deleting the
one row where a competitor draws level is precisely the behaviour this document exists to prevent.

Scoring is symmetric and was tightened *against* Gatepass to make it so. An earlier harness asked
only "did the tool find this case's own class", which silently forgave every off-target claim. Now
a claim of class D on a case that is not vulnerable for D counts as a false positive for D,
whoever made it. That change cost the naive LLM 8 false positives and Gatepass 1 — the Gatepass one
has since been fixed, and it was a real precision bug worth fixing on its own merits.

The durable difference is not recall. It is that the model's answer changes between runs and costs
~110,000 tokens, and that neither of the realistic prompt conditions is usable without an analyst
triaging its false positives.

## 5. What holds regardless of the detection number

**Precision.** 0 false positives on 99 clean cases — against negatives designed specifically to
induce them. This is the figure least dependent on corpus visibility, because the hard negatives
were written to defeat pattern matching and a rule that overfits to vulnerable fixtures tends to
fire on them.

**Evidence integrity.** 111 verified findings, **0 unconfirmable reproductions**. A finding reaches
the verified tier only when a cited file and line can be re-checked against the source; the schema
in `packages/findings` rejects one that cannot. This has never broken at any point in this work.

**Determinism.** Byte-identical output across 10 consecutive runs. 0 tokens, $0 marginal cost. The
LLM baseline is non-deterministic by construction.

**Speed.** 4.1 ms mean, 13.9 ms p95 per case. This is slower than earlier versions, which ran at
0.29 ms; repo-wide symbol resolution is what bought the recall. Any "sub-millisecond" claim is out
of date.

## 6. Honest limits

**Of the headline number.** Stated above and worth repeating: all 192 cases were visible during
development. 98.9% is an upper bound.

**Of the corpus.** It is authored, not harvested. Adversarial and largely independently written,
but not a random sample of real code. The third-party check on that is the public MCP server
survey: 168 real servers, 1 in 9 carrying a production agentic vulnerability, with a random sample
of findings re-verified against source at the recorded commit.

**Of one rule with no negative control.** The Chrome extension correlation (API and host
permissions against the manifest) is exercised by exactly one corpus case, and that case is the
vulnerable one. Its precision was checked against throwaway control trees during development, which
is weaker evidence than a corpus negative. A clean MV3 fixture is outstanding.

**Of static analysis.** Several things cannot be decided from source, and the detectors approximate
them: whether a committed credential is still live, whether an endpoint is genuinely
internet-facing, whether a version tag is immutable, whether validation happens in an API gateway
outside the repository, and whether a bound such as `maxLength: 10000000` is *sensible*. Every one
of those approximations is wrong at the edges.

**Of coverage.** Against the OWASP Top 10 for Agentic Applications: four categories have full
static coverage, five partial, and ASI06 (memory and context poisoning) none. That gap is declared
in `packages/findings/src/owasp-asi.ts` and enforced by a test that fails if coverage is claimed
without a detector behind it.

**Of the one miss.** `verified/rls-gap/vuln-no-scoping-column` — an `audit_log` table with no
tenant column at all. The detector deliberately skips tables with no tenant discriminator, which is
the same guard that keeps two clean fixtures (a currency lookup table, a set of global reference
tables) from firing. Separating an audit log from a lookup table needs a rule about what a table
*holds*, not what columns it has. Trading a working precision guard for one detection was declined.

**Of this process.** Three separate agents leaked evaluation case names during this work, by three
different routes (`find`, `ls -R`, `git status`). One engine change was made with knowledge of what
the evaluation set contained. Every incident is recorded in
[`corpus/INTEGRITY.md`](../corpus/INTEGRITY.md), including the ones nobody else would have found.

## 7. Reproducing all of it

```bash
pnpm benchmark:matrix                     # Gatepass, full corpus
pnpm benchmark:matrix -- --cleanroom      # clean-room subset
pnpm benchmark:incumbent                  # Gitleaks, Trivy (CodeQL skips, with its reason)
pnpm benchmark:semgrep                    # Semgrep via Docker
pnpm benchmark:llm-score                  # score the blind LLM baseline
pnpm benchmark:determinism
npx tsx benchmark/src/publish-v2.ts       # assemble benchmark/published/*.json
```

Raw outputs land in `benchmark/reports/`. The dev/holdout partition is a deterministic hash of each
case id, so it is identical on any machine and cannot be reshuffled into a friendlier score — though
as section 2 records, that partition no longer separates anything, because development eventually
saw all of it.
