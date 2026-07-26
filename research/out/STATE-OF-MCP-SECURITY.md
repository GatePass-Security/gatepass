# The State of MCP Security (2026)

**A static analysis of 168 public Model Context Protocol servers.**

Generated 2026-07-26 · Every number below is derived
from measured data in [`mcp-survey-aggregate.json`](./mcp-survey-aggregate.json). Raw per-repo
results, including commit SHAs, are in [`mcp-survey-raw.json`](./mcp-survey-raw.json).

## Headline

We scanned **168 public MCP server repositories** (119,868 source files)
with a deterministic static engine — no LLM involved. Two numbers matter, and we report both
because they mean different things:

| | Repos | Share |
|---|---|---|
| **Have an agentic-infrastructure vulnerability** (MCP transport, tool definitions, agent scope) | **24** | **14.3%** |
| Have any verified finding, including general web/app issues | 88 | 52.4% |

**The first row is the claim about MCP security.** Roughly **one in seven public MCP servers
ships an agentic-infrastructure vulnerability** — overwhelmingly an MCP transport exposed with
no authentication.

The second row is larger but less specific: it includes CORS misconfiguration, hardcoded
secrets, and missing row-level security. Those are real findings in real MCP repositories, but
they are *general application security* issues that happen to live in an MCP codebase. Reporting
them as "MCP security" would inflate the story, so we separate them.

Total verified findings: **1,762**, though the distribution is
heavily skewed — the median affected repository has **5** findings, while a handful of large
repositories account for hundreds each. Repository-level rates (above) are the robust statistic;
raw finding totals are not.

"Verified" has a specific meaning here: every finding carries a machine-checked reproduction —
a file and line that provably exists in the scanned commit. Nothing in this report is a
heuristic guess or a model's opinion. A random sample was independently re-checked against the
source at the recorded commit SHA (`research/out/verification.json`).

## The agentic findings

These are the MCP/agent-specific classes — the subject of this report.

| Class | ID | Repos affected | Findings |
|---|---|---|---|
| Unauthenticated MCP transport | `unauth-mcp-transport` | 23 (14%) | 123 |
| Tool input without schema validation | `missing-schema-validation` | 2 (1%) | 6 |
| Unbounded tool parameter | `unbounded-tool-param` | 1 (1%) | 39 |

## Findings by OWASP ASI category

| OWASP ASI (2026) | Repos affected | Findings |
|---|---|---|
| **ASI04** Agentic Supply Chain Compromise | 45 (27%) | 429 |
| **ASI02** Tool Misuse & Exploitation | 24 (14%) | 168 |
| **ASI03** Agent Identity & Privilege Abuse | 23 (14%) | 692 |
| **ASI07** Insecure Inter-Agent Communication | 23 (14%) | 123 |
| **ASI05** Unexpected Code Execution | 2 (1%) | 45 |

## All findings by vulnerability class

Includes the general application-security classes. These are genuine findings in MCP server
repositories, but they are not evidence about MCP/agentic security specifically.

| Class | ID | Repos affected | Findings |
|---|---|---|---|
| Wildcard CORS with credentials | `cors-misconfig` | 53 (32%) | 473 |
| Hardcoded secret / credential | `exposed-secret` | 34 (20%) | 296 |
| Multi-tenant table without row-level security | `rls-gap` | 23 (14%) | 692 |
| Unauthenticated MCP transport | `unauth-mcp-transport` | 23 (14%) | 123 |
| Unpinned dependency | `unpinned-dependency` | 17 (10%) | 133 |
| Tool input without schema validation | `missing-schema-validation` | 2 (1%) | 6 |
| Unbounded tool parameter | `unbounded-tool-param` | 1 (1%) | 39 |

## Method

- **Discovery.** GitHub search API — MCP server topics/names/SDK dependency. 300 candidate repositories were
  retrieved; **122 were excluded** because they were not actually MCP
  server implementations (awesome-lists, aggregators, unrelated tools), and 10
  failed to clone within the time budget. The denominator is only repositories confirmed to
  declare an MCP SDK dependency or implement an MCP server.
- **Engine.** Gatepass deterministic engine (no LLM; semanticEnabled=false). Ruleset `corpus-v1`.
- **Counting.** verified-tier findings only (machine-checked reproduction). Findings are de-duplicated by fingerprint, so a repeated
  pattern in one file counts once.
- **Exclusions.** node_modules, dist, build, .next, vendor, third_party, site-packages — a repository is never charged for its dependencies'
  problems.
- **Reproducibility.** `pnpm research:scan-mcp -- --limit 300`. The engine is
  deterministic (see below), so re-running against the same commit SHAs reproduces these numbers
  exactly.

## Why static, and why not an LLM

We measured this rather than asserting it. A frontier LLM, given the same taxonomy and the same
samples, **matches this engine on detection** for clean textbook cases — we published that result
rather than hiding it. What an LLM cannot provide is the properties that let a scanner be a **CI
gate**:

| | Gatepass engine | Frontier LLM (measured) |
|---|---|---|
| Deterministic across runs | **Yes** — byte-identical over 10 runs | No — varies with temperature, context, model version |
| Latency per scan | **~1 ms** | ~75 s per batch of 8 small samples |
| Tokens per scan | **0** | ~110,000 for 24 tiny samples |
| Marginal cost per scan | **$0.00** | Non-trivial, per PR, per repo, forever |
| Machine-checked reproduction | **Yes** | No — assertion only |

You cannot gate a pull request, or publish a reproducible precision figure, on an output that
changes between runs. That is the entire argument for a deterministic engine, and it is why the
numbers in this report are checkable by anyone.

Full methodology and the head-to-head against Semgrep, Gitleaks, and Trivy:
[`benchmark/COMPETITIVE-BENCHMARK.md`](../../benchmark/COMPETITIVE-BENCHMARK.md).

## What this engine covers, and what it does not

Roughly half of the OWASP ASI list describes **runtime** agent behaviour that no static analyzer
can establish before deployment. We state our position per category rather than implying blanket
coverage:

| OWASP ASI (2026) | Static coverage | Limitation |
|---|---|---|
| **ASI01** Agent Goal Hijack | ✅ full | Covers injection planted in tool definitions/descriptions shipped with the code. Hijack via content fetched at runtime is a runtime control. |
| **ASI02** Tool Misuse & Exploitation | ✅ full | — |
| **ASI03** Agent Identity & Privilege Abuse | ✅ full | — |
| **ASI04** Agentic Supply Chain Compromise | ✅ full | — |
| **ASI05** Unexpected Code Execution | ◐ partial | Gatepass detects unvalidated/unbounded input reaching tool handlers (the precondition). It does not yet trace a full taint path to an exec/eval sink. |
| **ASI06** Memory & Context Poisoning | ❌ none | Not yet covered. A static precondition exists (memory writes with no validation or segmentation) and is the highest-priority gap on the roadmap. |
| **ASI07** Insecure Inter-Agent Communication | ◐ partial | Covers unauthenticated transport and credential forwarding between services. Does not model multi-agent topology or trust chains. |
| **ASI08** Cascading Agent Failures | ◐ partial | Largely a runtime property. Gatepass detects the static precondition of an unbounded/uncapped agent loop. |
| **ASI09** Human-Agent Trust Exploitation | ◐ partial | Covers tool descriptions that understate or hide their real effect. Does not evaluate runtime UI/approval flows. |
| **ASI10** Rogue Agents | ◐ partial | Detection of a rogue agent is a runtime/monitoring problem. Gatepass detects the static enablers: unbounded loops and scope mismatches. |

**ASI06 (Memory & Context Poisoning) is our honest gap** and the top item on the roadmap.

## Responsible disclosure

Affected repositories are **not named** in this report. Maintainers of every repository with a
verified finding are being contacted privately with the specific file, line, and a suggested fix
before any public discussion of individual projects.

If you maintain an MCP server and want the findings for your repository — or want to verify a
result in this report — contact us and we will send the full detail.

## Scan your own MCP server

The engine used for this survey is the one that runs in Gatepass. It takes about a minute to
point it at your repository.
