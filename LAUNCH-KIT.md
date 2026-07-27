# 48-Hour Launch Kit

Everything you need for the four things only you can do. I generate the numbers; you do the
human work. **Do these in this order — order matters, because traction beats artifacts.**

---

## HOUR 0-2 — Deploy (do this FIRST, before the report)

Nothing here beats "10 teams ran it." The deploy is already configured.

```bash
DATABASE_URL="<neon connection string>" pnpm db:migrate
```

1. **Neon** (neon.tech, GitHub SSO) → new project → copy the connection string → run the
   migrate command above.
2. **Render** (render.com, GitHub SSO) → New → Blueprint → pick the `gatepass` repo. It reads
   [render.yaml](render.yaml). Fill in the env vars it prompts for (`DATABASE_URL`,
   `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` — paste the full PEM, `GITHUB_INSTALLATION_ID`,
   `GITHUB_WEBHOOK_SECRET`, `SESSION_SECRET`, `NVIDIA_API_KEY`).
3. **Vercel** (vercel.com, GitHub SSO) → import repo → **Root Directory = `apps/web`** → env
   `NEXT_PUBLIC_API_URL` = your Render URL.
4. Put the Vercel URL into Render's `GATEPASS_ALLOWED_ORIGINS`.
5. Point the GitHub App webhook at `https://<render-url>/v1/webhooks/github`.

Full detail: [DEPLOY.md](DEPLOY.md). Free tier caveat: Render sleeps after 15 min idle — add a
free UptimeRobot ping on `/healthz` before you demo.

**Then DM 5 people who build with MCP/agents.** Script:

> Hey — built a scanner for MCP/agent infrastructure (tool poisoning, confused deputy,
> unauth transports, scope mismatches). Deterministic, runs in ~1ms, no LLM. Can I run it on
> your repo and send you what it finds? No signup, I'll just send the results.

Five yeses is worth more in the YC app than every benchmark in this repo.

---

## HOUR 2-4 — Disclosure outreach (as survey results land)

Each verified finding in a public MCP server is a warm intro to exactly your user. Raw
per-repo results with commit SHAs: `research/out/mcp-survey-raw.json`.

**Email/issue template:**

> Subject: Security finding in <repo> (responsible disclosure)
>
> Hi — I'm <name>, building Gatepass, a static scanner for MCP/agent infrastructure.
>
> While running a survey of public MCP servers I found the following in <repo> @ <sha>:
>
> **<class>** — `<file>:<line>`
> <one-line explanation>
> Maps to OWASP ASI <ASIxx> (<title>).
>
> Suggested fix: <fix>
>
> I'm not publishing repo names — the survey report only reports aggregates. Wanted you to
> have this first. Happy to send the full scan output, and if it's useful I can wire it into
> your CI so it runs on every PR.
>
> — <name>

**Rules:** never name repos publicly, give the fix not just the finding, and always end with
the offer. That last line is the conversion.

---

## HOUR 4-8 — The report + post

The report auto-generates from measured data:

```bash
pnpm research:report
```

Output: `research/out/STATE-OF-MCP-SECURITY.md`. **Read it before posting** and sanity-check
2-3 findings by hand against the raw JSON — if one number is wrong, the whole thing burns.

### The actual survey numbers (measured 2026-07-26)

These are the **production-code** figures from
[`research/out/STATE-OF-MCP-SECURITY.md`](research/out/STATE-OF-MCP-SECURITY.md). An earlier
draft of this kit quoted 14.3% / 24 repos, which was measured **before** test and example paths
were separated out. That number is superseded — do not use it anywhere.

| Metric | Value |
|---|---|
| MCP servers scanned | **168** (300 discovered; 122 excluded as not-actually-MCP; 10 clone failures) |
| Source files | 119,868 |
| **Repos shipping an agentic-infrastructure vuln in production code** | **18 (10.7%)** ← *the MCP-security claim* |
| Repos with any verified finding in production code | 75 (44.6%) |
| Repos with any verified finding incl. test/example paths | 88 (52.4%) |
| Unauthenticated MCP transport (production) | **18 repos, 41 findings** ← the dominant agentic finding |
| Verified findings, production | 1,327 (median 3 per affected repo — heavily skewed) |
| Verified findings sitting in test/example paths (excluded) | 435 |
| Spot-check | 10/10 confirmed by re-cloning at the recorded SHA |

**Use 10.7%, not 44.6% and not 52.4%.** The bigger numbers are mostly CORS/secrets/RLS — real
findings, but general app-sec that happens to live in MCP repos. If you lead with 52% a security
reader will check, find it's mostly CORS *and partly test fixtures*, and dismiss the whole report.
Leading with "1 in 9 MCP servers ships an unauthenticated transport in production code" is
smaller, sharper, and *survives scrutiny* — and it's a scarier finding anyway. The three-number
table in the report exists so the reader can see you didn't pick the flattering one.

**HN title** (do not editorialize, HN punishes hype):

> Show HN: We scanned 168 public MCP servers — 1 in 9 ships an unauthenticated transport

**Post body skeleton:**

> We ran a deterministic static scanner over N public MCP server repos and mapped every
> finding to the OWASP Top 10 for Agentic Applications (2026).
>
> X% had at least one verified finding. Most common: <top 3 classes>.
>
> Method: only verified-tier findings (each carries a file+line reproduction that provably
> exists), deduped, vendored code excluded, repos confirmed to be actual MCP servers. Raw
> data and commit SHAs included so you can re-run it.
>
> We're not naming repos — maintainers were contacted privately first.
>
> The scanner is deterministic (byte-identical across runs, ~1ms, no tokens). We also
> benchmarked it against Semgrep/Gitleaks/Trivy and against a frontier LLM — the LLM matches
> us on detection for clean cases, which we published rather than hid. What it can't do is
> be a CI gate: non-deterministic output, ~110k tokens, ~75s.
>
> Data: <link> · Method: <link>

**Expect these comments and have the answer ready:**
- *"Your corpus is self-authored"* → Yes, stated in the report. That's why we also scanned N
  real third-party repos — those are the numbers that matter.
- *"An LLM does this"* → We measured that; it ties on detection. Then show the determinism /
  cost / latency table.
- *"Isn't this just Semgrep with extra steps"* → Semgrep found 1/12 agentic classes, Trivy 0/12.
  Show the head-to-head.
- *"Are these real vulns or noise?"* → Every one has a file+line reproduction; here's one.

---

## THE NUMBERS (for the YC app + the post)

Regenerate any of these:

| Claim | Command | Current value |
|---|---|---|
| Detection vs incumbents | `pnpm benchmark:incumbent` | Gatepass 12/12 · Semgrep 1/12 · Gitleaks 1/12 · Trivy 0/12 |
| Determinism / cost / latency | `pnpm benchmark:determinism` | byte-identical ×10 · 0.9 ms · 0 tokens · $0 |
| Corpus precision | `pnpm corpus:measure` | 12/12 classes, 100% TP, 0% FP |
| Compliance precision | `npx vitest run packages/compliance/test/measure.test.ts` | 0% FP, 100% recall |
| Public MCP survey | `pnpm research:scan-mcp -- --limit 300` | 168 servers · 10.7% production agentic vuln · 18 unauth transports |
| Lead list from the survey | `pnpm research:leads` | segments the raw survey into priority accounts |
| Survey spot-check | `pnpm research:verify -- --sample 14` | re-checks findings against source at recorded SHA |
| OWASP ASI coverage | — | 9/10 categories, ASI06 declared as the gap |

---

## YC APP NARRATIVE INPUTS

You write the story; these are the load-bearing facts.

**What we do (one sentence).** Gatepass is a deterministic security scanner for AI-native and
agentic codebases — it catches the vulnerability classes that appear when AI writes the code
and agents run it, and gates them in the pull request.

**Why now.** MCP went from a protocol to infrastructure in ~18 months. OWASP published a
dedicated Top 10 for Agentic Applications in Dec 2025. 30+ MCP CVEs landed in a 60-day window.
Meanwhile the tools teams actually run — Semgrep, Gitleaks, Trivy — detect **0-1 of 12** of
these classes. The category has a standard and an attack surface, and no pre-merge scanner.

**Why us.** We build MCP/agent infrastructure ourselves; we hit these bugs before we built the
scanner for them.

**The insight (this is the differentiated part).** Everyone reaching for this problem reaches
for an LLM. We measured that honestly: a frontier LLM matches us on *detection*. But it cannot
be a **gate** — non-deterministic output means no reproducible precision number and nothing
stable to block a PR on, at ~110k tokens and ~75s per run. Security gates need determinism,
machine-checked evidence, and zero marginal cost. That's an engineering moat, not a prompt.

**Traction (fill this in yourself — it's the part that matters).**
- Public MCP survey: X% of N real servers affected
- Design partners: <names>
- Repos scanned: <count>
- Disclosures sent / maintainers engaged: <count>

**The honest risk (say it before they do).** The buyer for "agentic security" is forming, not
formed. Our wedge is teams shipping MCP servers *now* who already feel this. If the budget line
arrives later than we think, we're a precision AppSec scanner for AI-generated code — which is
a real market today.

---

## WHAT NOT TO DO

- **Do not** name vulnerable repos publicly. It burns the exact maintainers you want as users.
- **Do not** claim "no one can beat us." Your own benchmark shows an LLM ties on detection.
  Publishing that *and* the determinism argument is far more credible — and every technical
  reader will verify it in five minutes.
- **Do not** write more features in the next 48 hours. The code is not the constraint.
- **Do not** claim ASI06 coverage. It's declared as a gap in the code; keep it that way.
