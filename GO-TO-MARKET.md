# Gatepass — Go-To-Market

*Written as a cofounder memo, not a pitch deck. It disagrees with parts of the current pitch on
purpose. Every market number is sourced at the bottom; every product number is regenerable from
this repo.*

---

## 0. TL;DR — the five decisions

1. **Sell bottom-up to the engineer who owns the MCP server, not top-down to the CISO.** The
   current pitch says "CISO budget, not engineering budget." That is the right *end state* and the
   wrong *opening move*. Everything you have actually built — a free CLI, PR comments, a
   deterministic CI gate — is a developer-led motion. At seed, a CISO motion is a 6–9 month cycle
   you cannot survive.
2. **Your #1 asset is not the scanner. It is the disclosure list.** The survey found 88 public MCP
   repos with verified findings, 18 shipping an agentic-infrastructure vuln in production code.
   Each one is a warm, name-and-line-specific intro to exactly your buyer. **That raw list is
   currently gitignored and not on disk — regenerating it is task #1.**
3. **Run 12 discovery calls a week for the next 8 weeks** (floor 8, stretch 15). ~100
   conversations before the YC application. Math and cadence in §7.
4. **Charge from day one. $500/mo design-partner price.** Free pilots prove nothing to YC and
   nothing to you.
5. **Cut Layer 4 (WCAG / CCPA / App Store) from the pitch.** It is a different buyer, a different
   category, and it makes a sharp security story sound like a compliance grab-bag. Keep the code;
   delete it from the narrative.

---

## 1. What you have actually built (the honest inventory)

This is the part that determines what you can sell *this month*, so it comes first.

### Shipping and verifiable today

| Asset | Evidence | GTM use |
|---|---|---|
| Deterministic scanner, 9 detectors / 12 classes | `pnpm corpus:measure` → 100% TP, 0% FP | The product |
| Free OSS CLI (`gatepass scan <path>`) | `cli/src/index.ts` | Distribution + every sales call |
| Head-to-head vs incumbents | Gatepass **12/12**, Semgrep **1/12**, Gitleaks **1/12**, Trivy **0/12** ([`benchmark/INCUMBENT.md`](benchmark/INCUMBENT.md)) | The differentiation slide |
| Determinism / cost | byte-identical ×10, ~0.9 ms, **0 tokens, $0** | The "why not just an LLM" answer |
| Public MCP survey | 168 servers, 119,868 files, **10.7% ship a production agentic vuln**, 23 unauth transports ([report](research/out/STATE-OF-MCP-SECURITY.md)) | The content engine + the lead list |
| Snyk Agent Scan can't compete pre-merge | It scans live configs/running servers, not source trees — documented in `INCUMBENT.md` | The "why is this a company" answer |
| API + Next.js dashboard (8 pages) + self-hosted runner protocol | builds, tests, lint clean | The demo |
| Evidence/questionnaire logic (SOC 2/ISO mapping, posture eval) | `packages/evidence` | The expansion story |

**358 tests, corpus gate passing, self-scan clean.** For a pre-YC company this is unusually real.
Most agentic-security seed pitches are a landing page and a demo video.

### Not built (say this out loud in every sales call — it converts better than pretending)

- **Postgres store** — the API runs in-memory. Fine for pilots, not for a paying multi-tenant customer.
- **GitHub App not wired to a live install** — PR comments and check runs are coded but never
  posted to a real repo. **This is the single highest-priority engineering item**, because "it
  comments on your PRs" is the entire developer motion.
- **Vanta/Drata exporters** — mapping logic exists, the API push does not.
- **No cloud deploy** — [`LAUNCH-KIT.md`](LAUNCH-KIT.md) has the Neon + Render + Vercel path, ~2 hours.
- **`research/out/mcp-survey-raw.json` is gitignored and absent.** Regenerate with
  `pnpm research:scan-mcp -- --limit 300`. Without it you have aggregate statistics and no leads.

### Three inconsistencies to fix before anything goes public

1. **Pricing contradicts itself.** [`GATEPASS_ONEPAGER_V4.md`](GATEPASS_ONEPAGER_V4.md) says Team
   $500–1,500/mo, Scale $2–5K/mo. Your newer summary says Growth $2,500/mo, Enterprise $35K/yr.
   Pick one (recommendation in §8).
2. **Dated model names.** The summary cites "Claude 3.5 Sonnet, GPT-4o." The repo actually wires
   NVIDIA NIM GLM 5.2. Anyone technical reading a 2026 pitch that names 2024 models discounts the
   whole document. Say what the code does, and name current-generation models.
3. **The 78% false-positive stat needs a citation attached to it.** It is your sharpest attack line
   and the first thing a security reader will try to verify. Put the source inline every time you
   use it, or drop it and lead with your own measured 12/12-vs-1/12 instead — which is *yours*,
   reproducible, and stronger.

Also: the dashboard's support page still promises a "guaranteed 4-hour response time" and 24-hour
ticket SLA that nothing backs (flagged in commit `e348add`). Cut those lines before a prospect sees
the dashboard. A company whose whole brand is "measured precision" cannot ship an unbacked SLA.

---

## 2. Market reality — where the money actually went

This matters because it tells you which door is still open.

**The category is funded and consolidating fast.** ~$3.6B into the top 10 agentic-AI-security
startups; ~$96B of security M&A across ~400 transactions in 2025; Alphabet–Wiz at $32B, Palo Alto–
CyberArk ~$25B. Every runtime AI-firewall company has been bought: **Lakera → Check Point, Prompt
Security → SentinelOne, Aim → Cato, Protect AI → Palo Alto, CalypsoAI → F5, Pangea → CrowdStrike.**

**Read that consolidation correctly.** It is not "the market is closed." It is *proof the acquirers
want this shelf* and have already cleared the runtime slot. The remaining unclaimed slot is
pre-deployment.

**Where the layers stand:**

| Layer | Who owns it | Status |
|---|---|---|
| Runtime firewall / prompt filtering | Lakera, Prompt Security, Prisma AIRS, CalypsoAI | **Consolidated — acquired.** Do not enter. |
| MCP gateway / proxy / identity | Runlayer ($11M, Khosla + Felicis), MintMCP, NeuralTrust, Lasso, Obot, Solo.io agentgateway, TrueFoundry, **Microsoft Agent 365 ($15/user/mo)** | **Crowded and now has Microsoft in it.** Do not enter. |
| Posture / governance / AI-SPM | Zenity (Gartner's "company to beat"), Noma ($132M), Pillar, WitnessAI ($85.5M), Operant | Funded, enterprise-sales-heavy |
| Traditional SAST + AI-code | Snyk, Semgrep, Checkmarx, Corgea, DryRun | Real market, incumbents strong, **0–1 of 12 agentic classes detected** |
| **Pre-merge static analysis of agentic infrastructure** | **— empty —** | **Your slot.** |

**The opening, stated precisely:** total disclosed funding for *pure-play MCP security* is roughly
**$40M across four startups** — against $3.6B in the broader category. And every one of those four
is at the gateway/runtime layer. **Snyk Agent Scan (the acquired Invariant `mcp-scan`) cannot scan a
source tree at all** — you verified this yourself in `INCUMBENT.md`. Nobody is gating the pull
request.

**Demand-side numbers that make the timing argument:**

- **10,000+ public MCP servers** (Anthropic, Dec 2025); 9,652 registry records and **15,926 GitHub
  repos** with the `mcp-server` topic by May 2026; **97M+ monthly SDK downloads**.
- **41% of software organizations have MCP servers in production** (Stacklok, 2026); ~45% among
  mid-to-large tech companies.
- **Agents are entering production ~7–8× faster than governance is being built around them.**
- **Security is the #1 stated barrier to enterprise MCP adoption.**
- Security budgets: AI's share is going from ~4% to ~15%; 70% of orgs already put >10% of security
  budget into AI-related spend; total infosec spend ~$244B in 2026.
- Procurement has changed: **SIG Lite and CAIQ now carry AI-governance sections**; ISO 42001 and
  NIST AI RMF are being asked for; **SOC 2 Type II is now a baseline that no longer differentiates.**

**And the channel nobody is talking about yet:** the Linux Foundation's **Agentic AI Foundation**
(Anthropic + OpenAI + Block, 150+ members in months) has a **security conformance program** on its
public roadmap, and the MCP Registry is already categorizing servers against the "lethal trifecta."
There is going to be a *standard* for "this MCP server was checked." Whoever supplies the reference
scanner for that standard wins the category. That should be an explicit 12-month goal (§10).

---

## 3. The strategic disagreement: who you sell to first

Your summary says: *"Gatepass is an enterprise governance tool, not a developer productivity tool.
It sells to the CISO/Security budget, not the Engineering budget."*

**As a statement about where the money eventually is, that's right. As an opening move it will kill
you.** Here's why:

- A CISO sale is 6–9 months, needs a security-team champion, procurement, vendor review, and
  usually a SOC 2 report *from you*. You don't have a company yet.
- CISOs at your target companies (10–150 people) **do not exist.** Your ICP explicitly has no
  security hire. The "CISO" is the CTO.
- Every artifact you've built is developer-shaped: a free CLI, a PR comment, a CI gate, IDE
  annotations, coding-agent guidance. That's a product-led motion. Don't fight your own product.
- The one thing that *does* reach a CISO — compliance evidence export — is the part that isn't
  built yet (Vanta/Drata push is deferred).

**The resolution — land dev, expand to security, price on the deal:**

```
LAND (week 0)          engineer who owns the MCP server
                       "here's a real finding in your repo, with the line and the fix"
                       free CLI → GitHub App → PR gate.        $0 → $500/mo

EXPAND (month 2-4)     their CTO / whoever owns the security questionnaire
                       "every MCP server in your org, gated, with evidence"    $2,000/mo

CONVERT (month 6-12)   the buyer's security team, or a real CISO at a larger org
                       fleet scanning, self-hosted runner, SOC 2 evidence      $30-50K/yr
```

The *pricing* rides the CISO logic (never per-seat, tied to unblocked revenue). The *entry* rides
the developer. Those are compatible; the current doc collapses them.

**One more thing to cut:** Layer 4 — the multi-agent WCAG 2.2 / CCPA / GDPR / Apple Privacy
Manifest checker. It is a genuinely different product for a genuinely different buyer, and it makes
the pitch sound unfocused at exactly the moment focus is the thing being judged. YC partners read
"we also do accessibility and app-store compliance" as "they haven't picked a market." Keep the
code. Delete it from the deck.

---

## 4. Who the customer is — three segments, ranked

### Segment A — the wedge: AI-native startups shipping a customer-facing MCP server
**Seed → Series B · 10–150 people · no security hire · in or entering enterprise procurement.**

- **Who signs:** CTO, VP Eng, or the founding engineer who personally wrote the MCP server.
- **Why they buy:** a prospect's security questionnaire now has an AI/agent section, and they
  cannot answer it. Their $150K–$500K deal is sitting in vendor review.
- **What they feel:** "we shipped an MCP server in a weekend, it's in production, nobody has looked
  at it, and now Acme Corp's security team is asking about tool permissions."
- **Deal size:** $500–2,500/mo. **Cycle: days to 3 weeks.** No procurement.
- **How to find them:** they have a public repo, a docs page describing their MCP server, and a
  company domain. See §5.1–5.3.

### Segment B — the scale-up: platform / AI-infra teams rolling out internal MCP
**200–5,000 people · a platform team has been told "make MCP safe for the company."**

- **Who signs:** Head of Platform Engineering, Director of AppSec, or Head of AI Enablement.
- **Why they buy:** they have 10–80 internal MCP servers written by teams with no security review,
  and they need every one scanned before it touches production data.
- **Deal size:** $2,000/mo → $30–50K/yr. **Cycle: 1–3 months.** Real procurement.
- **How to find them:** MCP Dev Summit / MCPCon attendee and speaker lists, AAIF member orgs,
  people posting "we rolled out MCP internally" on LinkedIn/HN. See §5.6.

### Segment C — the credibility logos: companies whose *product is an agent*
Coding agents, agent frameworks, MCP hosting/registry companies, AI-devtool startups.

- They get asked the hardest security questions in the market, they understand the problem
  instantly, and their logo makes every subsequent sale easier.
- **Cycle: fast if you have a finding.** They will also try to build it themselves — which is fine;
  half will conclude it's not their core and buy.

### Explicitly NOT your customer (say no to these fast)

- **Solo OSS MCP maintainers.** They'll take the free scan, thank you, and never pay. Great for
  distribution and the benchmark, zero revenue. Do not spend calls on them.
- **Large regulated enterprises not yet using agents.** 12-month cycle, wrong stage.
- **Pure LLM-wrapper apps with no MCP/agent surface.** They don't have your problem; selling them
  is how you convince yourself the product is wrong.

---

## 5. Where to find them — channel by channel, with expected yield

Ranked by expected conversations-per-hour. Tiers 1 first.

### 5.1 The disclosure list *(highest conversion in existence — start here)*

Every verified finding in a public MCP server is a warm intro with a technical gift attached.
[`LAUNCH-KIT.md`](LAUNCH-KIT.md) already has the template and the rules.

**Do this first, today:**

```bash
pnpm research:scan-mcp -- --limit 300
```

Then segment the raw output — this is the step the current plan is missing:

| Bucket | Action |
|---|---|
| Repo owned by a **company org** with a live product site | **Priority leads.** Disclose + offer CI wiring. |
| Repo owned by an **individual**, high stars | Disclose. Ask for a testimonial + a referral, not a sale. |
| Repo owned by an individual, low activity | Disclose (it's the right thing). No follow-up. |

Of 88 repos with findings, expect ~30–40% to be company-owned. That's **~30 priority leads**, each
receiving an email that names a file and a line number in their own code.

- **Expected reply rate: 30–45%.** (A cold security email with a specific verified finding and a
  fix is not cold.)
- **Yield: ~10–14 conversations from one afternoon of work.**
- **Rules, non-negotiable:** never name repos publicly; always give the fix, not just the finding;
  always close with the offer to wire it into CI. Use email or a private security advisory —
  **never a public GitHub issue** for a real vulnerability.

### 5.2 GitHub as a prospecting database

15,926 repos carry the `mcp-server` topic. Filter mechanically:

- owned by an **organization** (not a user account),
- pushed in the last 60 days,
- has a company website in the org profile,
- ≥1 non-trivial contributor.

That's your ~300-account target list. **Scan every one of them before you write a word.** Contact
only the ones with a finding. This turns cold outbound into disclosure outbound — the difference
between a 3% and a 35% reply rate.

### 5.3 Company-domain MCP discovery *(the best-qualified list nobody is building)*

Companies that publish a *product* MCP server have customers, which means they have procurement
pain, which means they can pay. Find them by:

- Docs pages: search for `"MCP server" site:docs.*` / `"our MCP server"` / `"connect via MCP"`,
- `.well-known` MCP endpoints and public MCP registry entries with commercial domains,
- Changelog/launch posts: "we shipped an MCP server" on X, LinkedIn, Product Hunt, HN.

These are Segment A dead-center. Expect a smaller list (~100–150) with a much higher close rate.

### 5.4 The report + Show HN

[`LAUNCH-KIT.md`](LAUNCH-KIT.md) has the title already, and it's the right one:

> **Show HN: We scanned 168 public MCP servers — 1 in 7 exposes an unauthenticated transport**

*(Reconcile the number first — the report's production-code headline is 10.7%, "1 in 9"; the 14%
figure includes test paths. Use the production number. It's smaller, it survives scrutiny, and
surviving scrutiny is the entire brand.)*

- **If it hits the front page:** several hundred CLI installs, 10–30 inbound conversations, 2–5
  genuinely qualified. Plus permanent SEO and a citable artifact for the YC app.
- **If it doesn't:** you still have the report as an outbound attachment forever. There's no
  downside case.
- Post Tue–Thu, 8–10am ET. Be in the comments for the first 4 hours — the comments convert better
  than the post. LAUNCH-KIT has the four objections pre-answered; know them cold.
- **Repost surfaces:** r/mcp, r/LocalLLaMA, r/netsec (report only, no promo), Lobsters, dev.to,
  the AAIF Discord, Latent Space and AI Engineer Discords, MLOps Community Slack.

### 5.5 Your own network *(do not skip because it feels too easy)*

You build MCP servers professionally at ZiliconCloud and you're CTO at Thesisly. Between the two
you can probably name 20–30 people who have shipped an MCP server this year. **This is your highest
close-rate channel and it takes one evening to list.** Warm intros close at 5–10× cold.

Ask each one for two things: a scan, and one intro to someone else shipping MCP.

### 5.6 Conferences and the standards body *(weeks 3–10)*

| Event | When | Play |
|---|---|---|
| **MCP Conference, San Jose** | Sept 24, 2026 (~200 attendees) | Submit a talk on the survey. 200 attendees, all of them ICP. |
| **AgenCon + MCPCon Europe, Amsterdam** | Sept 17–18, 2026 | Speak or attend |
| **MCP Dev Summit North America** | Oct 22–23, 2026 | CFP — "What we found in 168 public MCP servers" |
| **AAIF working groups / Discord** | ongoing, free | Contribute to the security workstream |
| **OWASP ASI community** | ongoing, free | Contribute your ASI→detector mapping; get listed as tooling |

A 20-minute talk with real survey data produces 30–60 qualified conversations over two days. It is
the single highest-density channel available to you, and the CFPs are open now.

The AAIF play deserves emphasis: their roadmap includes a **security conformance program**. Show up
in that working group with the only open, versioned, reproducible MCP-security corpus in existence
and you are positioned to become the reference implementation. That is worth more than any
individual customer.

### 5.7 Compliance-motion channels *(the "unblock the deal" buyer)*

- **Vanta and Drata partner/integration marketplaces.** They ingest scanner outputs and actively
  want feeds. Being listed puts you in front of the exact person whose deal is stuck. Finish the
  exporters (T083) and apply.
- Communities where questionnaire pain is discussed out loud: Vanta/Drata customer Slacks, r/SOC2,
  the "we're going through vendor review" corner of every founder community.
- **Content on questionnaire intent** — this is your SEO wedge, because it's a buying-moment search:
  - "how to answer the AI section of a security questionnaire"
  - "MCP server security checklist"
  - "OWASP Agentic Top 10 mapped to controls"
  - "SOC 2 evidence for AI agents"
  - "is our MCP server secure enough for enterprise procurement"

### 5.8 Communities to be *present* in (not to spam)

MCP/AAIF Discord · Latent Space · AI Engineer · Cursor and Claude Code communities · MLOps
Community Slack · LangChain / LlamaIndex Discords · r/mcp · r/netsec · Vercel/Modal AI communities.

Rule: answer MCP security questions helpfully for four weeks before you ever mention Gatepass. In
security communities, a single promotional post buys a permanent reputation cost.

### 5.9 Later, once you're in YC

The **Bookface** directory is the highest-density B2B list in the world for exactly your ICP — a
few thousand companies, disproportionately AI-native, shipping MCP servers, all reachable, all
predisposed to buy from a batchmate. Many YC B2B companies get their first 10 customers entirely
inside it. Plan for it; do not count on it.

### Channel scorecard

| Channel | Effort | Leads | Conversion | Priority |
|---|---|---|---|---|
| Disclosure list | Low | ~30 | **Very high** | **1 — today** |
| Your network | Very low | 20–30 | **Very high** | **1 — today** |
| Company-domain MCP discovery | Medium | 100–150 | High | 2 |
| GitHub org-owned + scan-first | Medium | ~300 | Medium-high | 2 |
| Show HN + report | Medium | 100s | Medium | 3 — week 2 |
| Conferences / CFPs | High | 30–60/event | High | 3 — submit now |
| AAIF / OWASP | Medium, ongoing | Strategic | — | 3 |
| Vanta/Drata marketplace | High (needs T083) | Steady | High intent | 4 |
| SEO / content | High, slow | Compounding | Medium | 4 |

---

## 6. How to contact them — the actual scripts

### 6.1 Disclosure email (Segment A/C, company-owned repo)

> **Subject:** Unauthenticated MCP transport in `<repo>` (responsible disclosure)
>
> Hi <name> — I'm <name>, I build MCP servers at ZiliconCloud and I've been running a static
> security survey of public MCP server repositories.
>
> In `<repo>` @ `<sha>` I found:
>
> **Unauthenticated MCP transport** — `<file>:<line>`
> The transport accepts connections without verifying an identity, so any client that can reach the
> port can invoke your tools. Maps to OWASP ASI07 (Insecure Inter-Agent Communication).
>
> Fix: `<one-line fix>`
>
> I'm not naming repos publicly — the report only publishes aggregates, and I'm contacting
> maintainers first. Happy to send the full scan output for the repo.
>
> If it's useful, I can wire the scanner into your CI so it runs on every PR — it's deterministic,
> ~1ms, no LLM, no cost per run. Takes about ten minutes.
>
> — <name>

**Why it works:** it's a gift, not an ask; it's specific enough to be checkable in 30 seconds; the
OWASP mapping signals you're not a random person; and the last line is the whole conversion.

### 6.2 Cold outbound, scan-first (no finding — use sparingly)

> **Subject:** your MCP server + enterprise security reviews
>
> Hi <name> — saw <company> ships an MCP server for <use case>.
>
> Quick question rather than a pitch: when enterprise prospects send you a security questionnaire,
> is there an AI/agent section yet, and who answers it?
>
> Reason I ask — I scanned 168 public MCP servers and about 1 in 9 ships an agentic-infrastructure
> vulnerability in production code, mostly unauthenticated transports. Semgrep and Trivy catch
> essentially none of these classes (1/12 and 0/12 in a head-to-head I published).
>
> I'd offer to run our scanner on <company>'s repo and send you whatever it finds. No signup, no
> pitch — I just want to know whether the findings are useful to you.
>
> — <name>

A question converts better than a claim. "Who answers the AI section?" both qualifies the account
and surfaces the buyer in one line.

### 6.3 Warm intro request

> Quick ask — do you know anyone shipping an MCP server in production? I'm running free security
> scans on them and writing up what I find. Two so far had unauthenticated transports. No pitch,
> I'm trying to learn whether the findings are actually useful before I build more.

### 6.4 Channel etiquette

| Channel | Use for | Never |
|---|---|---|
| Email / `security.txt` / private advisory | Actual vulnerabilities | — |
| GitHub **private** security advisory | Serious findings, high-profile repos | Public issue for a real vuln |
| LinkedIn | Segment B (platform/AppSec leads) | Segment A engineers — they don't read it |
| X / Discord DM | Segment A engineers, after public interaction | Cold DMs with no prior context |
| HN comments → DM | Warmest inbound you'll get | Pitching in-thread |

### 6.5 The one rule for every conversation

**Never take a call without having scanned their repo first.** If it's public, scan it before the
call and open with the findings. If it's private, spend the first five minutes getting the CLI
running on their machine. A security call with no findings is a survey; a security call with
findings is a sale. This is the single highest-leverage habit available to you, and your product is
literally built for it — 1ms, free, no infra.

---

## 7. How many customer calls per week — the answer

### The number: **12 discovery calls per week. Floor 8. Stretch 15.**

Hold that for **8 weeks** → **~100 conversations before the YC application.**

That number is chosen, not guessed:

- **Below 8/week you don't learn fast enough.** Pattern recognition in a forming market needs
  volume; a forming buyer needs more, not less. You're trying to answer "does the questionnaire
  pain or the vuln pain drive the purchase?" — that takes dozens of data points, not five.
- **Above 15/week solo you stop shipping**, and your top engineering gap (the GitHub App) is
  load-bearing for the sale itself.
- **~100 conversations is the number that reads as credible in a YC application.** "We talked to 100
  teams building MCP servers, 40 ran the scanner, 12 had verified findings, 3 are paying" is a
  different application from "we think the market is big."

### The funnel math that produces 12 calls

```
100 outreach touches/week   (20/day × 5 days — 60% disclosure-based, 40% cold)
  ↓ disclosure ~35% reply · cold ~5% reply
~25 replies
  ↓ ~50% convert to a booked call
~12 calls/week
```

**20 personalized touches a day is ~75 minutes** if your list is pre-scanned. It is not a full-time
sales job; it's a morning block.

### Time budget (this is what makes it sustainable)

| Activity | Hours/week |
|---|---|
| 12 calls × 30 min | 6.0 |
| Prep — scan their repo, read their docs | 2.0 |
| Follow-up, notes, CRM | 3.0 |
| Prospecting + list building | 3.0 |
| **GTM total** | **~14 hrs (≈2 days)** |
| Building | ~3 days |

Two days selling, three days building, pre-PMF. If you're spending five days building right now,
you're optimizing the wrong variable — the code is genuinely not the constraint (LAUNCH-KIT says
this too, and it's right).

### Composition of the 12

| Type | Count | Purpose |
|---|---|---|
| **New discovery** (Segment A/C, disclosure-sourced) | 7 | Learning + pipeline |
| **Design-partner deepening** (existing users) | 3 | Retention, expansion, case studies |
| **Expert calls** (AppSec leads, CISOs, compliance consultants — will never buy) | 2 | Truth. They tell you what enterprises actually ask, which feeds both the ruleset and the questionnaire product. |

Those 2 expert calls per week are the ones you'll be tempted to cut. Don't — the onepager names
"outcome data: which findings enterprises' security reviews actually probe" as moat #4, and expert
calls are literally how you acquire it.

### Cadence discipline

- **Monday:** rebuild the list, send the week's first 20 touches.
- **Tue–Thu:** call days. Batch them. 3–5/day.
- **Friday:** synthesis. Write down: what broke, what phrase made people lean in, what they asked
  for that doesn't exist. Ship the smallest thing that came up twice.
- **Every call:** recorded (with consent), notes in one doc, one-line summary of *their* words —
  not your paraphrase. Verbatim customer language is what makes a YC application sound real.

### After the application / after first revenue

Shift to **8 new + 6 pipeline-advancement** calls. The ratio moves from learning to closing once
you can articulate the pitch without changing it week to week.

---

## 8. Pricing — the recommendation

Resolve the contradiction as follows:

| Tier | Price | Contains | Who |
|---|---|---|---|
| **OSS / Free** | $0 | Unlimited local CLI scans, all verified detectors, SARIF output | Distribution. Never gate this. |
| **Team** | **$500/mo** | Private repos, GitHub App, PR comments, CI gate, up to 10 repos | Segment A entry |
| **Scale** | **$2,000/mo** | Unlimited repos, MCP fleet view, evidence export, questionnaire drafting, research-tier findings | Segment A expansion / Segment B entry |
| **Enterprise** | **$30–50K/yr** | Self-hosted runner, in-VPC semantic layer, SSO, support SLA, custom detectors | Segment B |

**Design-partner offer (use this for the next 8 weeks):** $500/mo, 6-month commitment, 50% off if
they agree to a logo, a case study, and a 20-minute call every two weeks.

**Why charge immediately:**

1. Free pilots have ~0% signal. Paid pilots have ~100%. You need to know which one you're in.
2. YC asks "are you making money?" A $500/mo customer at application time beats 50 free users.
3. $500/mo is *below the threshold where procurement gets involved* at a 10–150 person company —
   a CTO expenses it. That's deliberate. It's the fastest path from conversation to revenue.

**The value anchor for the $2,000 tier** — use it verbatim on calls:

> "You've got a $200K contract sitting in vendor review because you can't answer their agent-
> security questions. Gatepass is $2K/month. That's 1% of the contract, and it turns a two-week
> back-and-forth into an evidence export."

**What not to do:** per-seat pricing (taxes adoption of a tool you *want* every developer running),
and per-scan pricing (your marginal cost is $0 and your whole argument is that scanning should be
free at the margin — don't contradict your own moat with your price list).

---

## 9. Messaging — three pitches for three buyers

**To the engineer (Segment A, cold/disclosure):**
> "Your MCP transport at `server.ts:47` accepts connections without auth. Semgrep and Trivy don't
> catch this class — we published the head-to-head. Here's the fix, and here's a 1ms CI check so it
> can't come back."

**To the CTO (Segment A, expansion):**
> "When a prospect asks how you secure your agents, you currently answer from memory. Gatepass makes
> that answer a generated artifact mapped to SOC 2 controls, with a scan behind every line."

**To the platform lead (Segment B):**
> "You have 40 internal MCP servers written by teams with no security review. Gatepass gates every
> one of them at the pull request, deterministically, so the same commit always produces the same
> verdict — which means you can actually block on it."

**The one-liner (use everywhere):**
> **Gatepass is the pre-merge security gate for AI agents and the code they run. Deterministic, with
> a machine-checked reproduction behind every finding — because you can't block a pull request on an
> LLM's opinion.**

That last clause is your best sentence. It's the whole strategy in twelve words: it explains the
architecture, dismisses the obvious objection, and is verifiable in five minutes.

---

## 10. The 8-week plan

**Week 1 — Infrastructure and the list**
- Deploy (Neon + Render + Vercel, ~2h, per LAUNCH-KIT).
- **Wire the GitHub App to a real repo and post a real PR comment.** Highest-leverage engineering
  work available. Nothing sells without it.
- `pnpm research:scan-mcp -- --limit 300` → regenerate raw list → segment by owner type.
- List 25 people from your own network.
- Cut the unbacked support-page SLA copy. Reconcile the pricing page.
- **Ship 30 disclosures. Book 8 calls.**

**Week 2 — Publish**
- Sanity-check 3 report findings by hand against raw JSON. Then Show HN.
- Live in the comments for 4 hours. Reply to every technical objection with data.
- Submit CFPs: MCP Conference San Jose, MCPCon Europe, MCP Dev Summit NA.
- **12 calls.** First design-partner conversation.

**Weeks 3–4 — Convert**
- Land **2 paying design partners at $500/mo.**
- Build the 300-account org-owned GitHub list; scan-first outbound.
- Join the AAIF security workstream. Contribute the ASI→detector mapping to OWASP.
- **12 calls/week.**

**Weeks 5–6 — Prove retention**
- Design partners on CI, gating real PRs. Get one to say "it caught something before it shipped."
- Finish the Vanta exporter → apply to both partner marketplaces.
- First case study with a real number.
- **12 calls/week.**

**Weeks 7–8 — Package**
- Target: **3–5 paying customers, $1,500–5,000 MRR, 50+ repos scanned, 100+ conversations.**
- Re-run the survey at n=500 for a v2 report — a repeated measurement makes it a *benchmark*, not a
  blog post. That's the moat becoming visible.
- Write the YC application from the notes, not from imagination.

---

## 11. What goes in the YC application

Answer these with what you'll actually have:

**What do you do?**
> Gatepass finds security vulnerabilities in AI agents and MCP servers before the code ships, and
> blocks the pull request. It's deterministic — every finding comes with a machine-checked
> reproduction — which is what lets it be a CI gate instead of a report.

**Why now?**
> MCP went from protocol to infrastructure in 18 months — 10,000+ public servers, 97M monthly SDK
> downloads, 41% of software orgs running one in production. OWASP shipped a dedicated Agentic Top
> 10 in Dec 2025. The tools teams actually run — Semgrep, Gitleaks, Trivy — detect 0–1 of the 12
> classes; we measured it. There's a standard, an attack surface, and no pre-merge scanner.

**Why you?**
> We build MCP servers and agent systems professionally, and did the SOC 2 / detection-engineering
> side at the same company. We hit these bugs ourselves before we built the scanner for them.

**Traction** *(fill with real numbers, never rounded up)*
> N public MCP servers scanned · X% shipping an agentic vuln in production code · N maintainers
> contacted · N design partners · $N MRR · N repos gated in CI.

**What's the insight competitors don't have?** *(this is your best answer — lead with it)*
> Everyone reaching for this problem reaches for an LLM. We measured it honestly and published the
> result: a frontier LLM matches us on *detection*. But it can't be a *gate* — non-deterministic
> output means no reproducible precision number and nothing stable to block a PR on, at ~110k
> tokens and ~75s per run. Security gates need determinism, machine-checked evidence, and zero
> marginal cost. That's an engineering moat, not a prompt.

**Biggest risk?** *(say it before they do — YC rewards this)*
> The budget line for "agentic security" is forming, not formed. Our wedge is teams shipping MCP
> servers today who already feel it. If the line item arrives later than we think, we're a precision
> AppSec scanner for AI-generated code — a real market now.

**Things YC will push on — have these ready:**
- *"Why doesn't Snyk just add this?"* → They tried; they bought Invariant's mcp-scan. It scans live
  configs and running servers — pointed at a source tree it produces nothing. Pre-merge is a
  different architecture, not a feature toggle. (You have this documented and reproducible.)
- *"Isn't this a feature of an MCP gateway?"* → A gateway sees traffic after deploy. We block the
  commit. Runlayer et al. are complementary; the gateway can't stop you shipping the vuln.
- *"Is the market real today?"* → Show the survey, the funnel, and the paying customers. Not the TAM slide.

---

## 12. What to measure weekly

Post these in one place every Friday:

| Metric | Week-8 target |
|---|---|
| Conversations held | 100 cumulative |
| Repos scanned (external) | 500+ |
| Disclosures sent → replies | 60 → 20 |
| CLI installs | 200+ |
| Repos with Gatepass in CI | 10 |
| Paying customers | 3–5 |
| MRR | $1,500–5,000 |
| Findings that caught something pre-merge (customer-confirmed) | ≥3 |

That last row is the one that matters most and is easiest to forget to collect. "Gatepass blocked a
PR that would have shipped an unauthenticated transport" is worth more than every benchmark in the
repo — get the customer to say it in their own words, in writing.

---

## 13. Do this in the next 72 hours

1. `pnpm research:scan-mcp -- --limit 300` — regenerate the raw list. **Nothing else matters until
   this exists.**
2. Segment it: company-owned vs. individual. Build the ~30-lead priority sheet.
3. Deploy (2 hours, LAUNCH-KIT §Hour 0-2).
4. Wire the GitHub App against one real repo; post one real PR comment; screenshot it.
5. Write the 25 names from your own network into a sheet.
6. Send the first 15 disclosure emails.
7. Book the first 5 calls.
8. Submit one conference CFP.

---

## Sources

Market and funding: [Agentic AI security funding & M&A, RSAC 2026](https://softwarestrategiesblog.com/2026/03/28/agentic-ai-security-startups-funding-mna-rsac-2026/) ·
[Information security spending 2026](https://softwarestrategiesblog.com/2026/03/24/information-security-spending-2026/) ·
[Runlayer launch — $11M seed](https://techcrunch.com/2025/11/17/mcp-ai-agent-security-startup-runlayer-launches-with-8-unicorns-11m-from-khoslas-keith-rabois-and-felicis) ·
[McKinsey — securing the agentic enterprise](https://www.mckinsey.com/capabilities/risk-and-resilience/our-insights/securing-the-agentic-enterprise-opportunities-for-cybersecurity-providers)

MCP adoption: [MCP adoption statistics 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) ·
[MCP server statistics](https://techrt.com/mcp-server-statistics/) ·
[Enterprise MCP adoption, July 2026](https://andrew.ooo/answers/mcp-model-context-protocol-enterprise-adoption-july-2026/)

Competitive landscape: [Best MCP gateways 2026](https://obot.ai/blog/the-13-best-mcp-gateways-for-enterprise-teams/) ·
[MCP gateway security comparison](https://neuraltrust.ai/blog/best-mcp-gateways) ·
[Top AI SAST tools 2026](https://www.dryrun.security/blog/top-ai-sast-tools-2026) ·
[Best SAST tools compared](https://corgea.com/learn/best-sast-tools)

Buyer & procurement: [Enterprise AI security questionnaires](https://www.aetos-data.com/answers-insights/enterprise-security-ai-questionnaires) ·
[2026 AI procurement checklist](https://www.docket.io/blog/the-2026-ai-procurement-checklist-vetting-your-ai-agent-for-security-privacy-and-trust) ·
[Buyer-side governance for AI agent vendors](https://zylos.ai/research/2026-07-02-buyer-side-governance-enterprise-ai-agent-deployments/) ·
[AI security budget percentage](https://www.reco.ai/ciso-hub/what-percentage-security-budget-ai-security) ·
[CSA — AI agent governance gap](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-agent-governance-framework-gap-20260403/)

Standards & community: [Linux Foundation forms AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) ·
[Anthropic donates MCP to AAIF](https://anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation) ·
[MCP Dev Summit NA recap](https://aaif.io/blog/mcp-is-now-enterprise-infrastructure-everything-that-happened-at-mcp-dev-summit-north-america-2026/) ·
[MCP Conference San Jose](https://www.mcp-conference.com/san-jose) ·
[MCP & AI conferences 2026](https://mcpmanager.ai/blog/ai-conferences-list/)

YC method: [How to talk to users](https://www.ycombinator.com/library/Iq-how-to-talk-to-users) ·
[Sales advice for technical founders](https://www.ycombinator.com/blog/sales-advice-for-technical-founders/) ·
[YC's essential startup advice](https://www.ycombinator.com/blog/ycs-essential-startup-advice/)

Internal (regenerable): [`benchmark/INCUMBENT.md`](benchmark/INCUMBENT.md) ·
[`research/out/STATE-OF-MCP-SECURITY.md`](research/out/STATE-OF-MCP-SECURITY.md) ·
[`LAUNCH-KIT.md`](LAUNCH-KIT.md) · [`HANDOFF.md`](HANDOFF.md)
