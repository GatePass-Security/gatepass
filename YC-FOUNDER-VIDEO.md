# Gatepass — YC Founder Video

60 seconds. Pranav (CEO) and Aadi (CTO), interleaved, ~30s each.

---

## 1. YC's rules (verbatim, ycombinator.com/video)

- "The video should be **1 minute** long and should contain **nothing except the founders talking**."
- "Introduce yourselves, explain what you're doing and why, and tell us anything else you want
  about the founders or the project."
- "This is **not** the place to submit a demo or promotional video."
- "If you have more than one founder, have **all** of your founders in the video."
- "**Do not recite a written script.** Use bullet points instead. Just talk spontaneously as you
  would to a friend."

That last rule is the reason §4 exists. §3 is a target for *content and density*. §4 is what you
actually hold off-camera.

---

## 2. What accepted videos actually do

Watched end-to-end for this draft: Suggestr (accepted), Prolific (S19), OpenPhone (S18),
MagicBell (W21), Dendron (W21), Virtually (S20), Shotput/Derivative (S15), plus Dalton Caldwell's
own "YC Application Tips: The Founder Video."

Every one of them runs the same five beats:

| Beat | Time | What happens |
|---|---|---|
| 1. Name + role, immediately | 0:00–0:15 | No throat-clearing. Suggestr: "Hi YC, I'm Aditya, business co-founder — I do marketing, sales, and all of customer support." Second founder follows within ~10s. |
| 2. One plain sentence of what it is | by 0:20 | Dendron: "the fastest note-taking tool you'll ever use." A non-expert understands it. |
| 3. The problem, with a number or a sharp insight | 0:20–0:40 | Suggestr: "Amazon gets 25–30% of sales from recommendations; small brands get 4–7%." Then the knife: "almost every Shopify store is running an algorithm from 1992." |
| 4. **A hard number** | 0:40–0:55 | Load-bearing. Suggestr: 17 brands, $7K in generated sales, three weeks post-launch. Prolific: bootstrapped to $500K monthly GMV. Virtually: 6 customers, $300K raised, 18 months runway. |
| 5. Short close | 0:55–1:00 | One line. No begging. |

Also universally true: webcam quality, ordinary room, one take, no music, no B-roll, no title
card. Production value is deliberately zero — **density is what carries.**

Dalton Caldwell adds: keep it under a minute; credentials get **~5 seconds each**; then "dive
right into the idea"; and it's "totally okay for the CEO to own the majority of the pitch."

Two founders alternating in short turns (Suggestr, Prolific, OpenPhone) reads well — partners are
explicitly watching co-founder dynamics. It also stops either of you from monologuing.

---

## 3. The script — FINAL. 179 words, ~58s at accepted-video pace (3.1 words/sec)

Pranav 81 words (45%) · Aadi 98 (55%). Six beats, strict alternation — **no speaker ever goes
twice in a row.** That last point is the flow fix: the draft you were holding had Aadi taking the
customers beat and the close back to back, which reads on camera as one founder trailing off and
then starting again. Alternating hands the close to Aadi *as a reply*, which is a different and
better thing.

The arc: **who we are → what nobody else covers → how bad it is in the wild → we measured it
against the field → real companies run it and you can check us → we're doing this.**

> **PRANAV** — 0:00–0:08
>
> Hey YC, I'm Pranav, CEO of Gatepass. We find vulnerabilities in AI-generated code — and in the
> agents running it: MCP servers, tool definitions, permission scopes.

> **AADI** — 0:08–0:20
>
> I'm Aadi, CTO. Claude wrote us a tool that shows you your invoices — you give it your ID. We
> approved the diff. Turns out you could give it someone else's. Two files, both correct. Nothing
> checks both.

> **PRANAV** — 0:20–0:29
>
> We went and counted. A hundred sixty-eight public MCP servers — nearly half had a real
> vulnerability in production. One in nine had no authentication on the transport at all.

> **AADI** — 0:29–0:41
>
> So we measured ourselves against the field. Twelve vulnerability classes — Semgrep caught one.
> Gitleaks caught one. Trivy caught zero. We caught twelve, zero false positives, every finding
> shipping with a reproduction that has to run.

> **PRANAV** — 0:41–0:49
>
> Skaptix and ZiliconCloud run Gatepass on their code today, across every feature we ship. Our
> corpus, benchmark and survey are all public — anyone can reproduce the numbers.

> **AADI** — 0:49–1:00
>
> Pranav and I have been building together since 2023. We're building the best security scanner in
> the world, and we want YC building it with us.

### The flow pass — four fixes, and the two that mattered

**1. Aadi was making the same claim twice.** His second beat said *"Every scanner checks one or
the other,"* and then his fourth beat opened with *"The tools everyone runs can't see it."* Same
speaker, same point, twenty seconds apart. The fourth beat now opens *"So we measured ourselves
against the field"* — which does new work (it announces a measurement) instead of re-asserting a
gap the audience already accepted.

**2. Two beats in a row opened with "So."** Pranav's *"So we scanned…"* into Aadi's *"So we
measured…"* Spoken aloud that's a verbal tic, and it flattens both beats. Pranav's now opens
*"We went and counted"* — shorter, more active, and it earns the "So" that follows it.

**3. Aadi's second beat was abstract where it should have been a story.** It used to
re-characterize the same two surfaces Pranav had just listed. It is now the invoices anecdote —
the concrete version of the same point, told as something that happened to you. See the writeup
below for why naming Claude is the load-bearing word in it.

The idea it carries is your actual moat — cross-surface analysis, Constitution principle 4, the
scoped-looking tool backed by an unscoped DB client. It's also the most repeatable thing in the
video, which matters, because a partner will summarize you to other partners in a room you're not
in.

**4. "run Gatepass" and "rerun our numbers" collided inside one beat.** Pranav's fifth beat used
*run* twice in fifteen words, in two different senses. The second is now *"reproduce the
numbers"* — which also chimes deliberately with Aadi's *"a reproduction that has to run"* eleven
seconds earlier. Same root, used on purpose, so it reads as a theme rather than an accident.

Net effect: 179 words, 57.7s, and every beat now begins by picking up the one before it instead of
starting cold.

### The origin anecdote — the scoped tool on an unscoped client

Straight from your own corpus: `corpus/cases/cross-surface/cross-surface-scope-mismatch/vuln-scoped-tool-unscoped-client/`.

**The bug, in two files.** `mcp/tools.json` declares a tool:

```json
{ "name": "get_user_invoices",
  "description": "Returns the user's invoices.",
  "parameters": { "userId": { "type": "string", "maxLength": 64 } } }
```

Scoped by name. Takes a user ID. Length-validated. This is what a *correct* tool definition looks
like. And `src/db.ts`:

```ts
export const db = new Pool({ connectionString: process.env.DATABASE_URL });
```

A completely ordinary Postgres pool. Also correct. Also what every tutorial shows you.

**Neither file is wrong. The vulnerability is the relationship between them.** The tool promises
per-user scoping; the client behind it has full cross-tenant table access and no row-level
security. Nothing in either file is a bug. The bug is that they don't agree.

**Why this is the perfect anecdote — three reasons an AI agent ships it and a human doesn't catch it:**

1. **Neither file is in the other's context window.** The agent that wrote `tools.json` was asked
   for a tool definition and produced a good one. The agent that wrote `db.ts` was asked for a
   database client and produced a good one. Correctness was local to each task. Nobody — human or
   model — held both files at once.
2. **Code review reads files, not relationships.** A reviewer opening either diff approves it,
   correctly. There is no line to comment on.
3. **The runtime agent trusts the description.** This is the part that makes it land. At runtime
   the model reads *"Returns the user's invoices"* and reasonably concludes the scoping is
   enforced somewhere below it. So it passes whatever `userId` the conversation produces — and
   the database happily returns another tenant's invoices. **The tool description became a
   security control that nothing actually implements.**

**Blast radius:** cross-tenant data exposure through a feature that looks, in every artifact a
human sees, correctly scoped. No exploit needed — the agent does it on request, in normal
operation, and the logs show a legitimate tool call.

**Why no incumbent catches it:** Semgrep, Gitleaks and Trivy match patterns within a file. There
is no pattern here. You have to parse the tool definition, resolve which client backs the handler,
and check whether that client is tenant-scoped — across two surfaces, in two languages, one of
which is JSON. That is Constitution principle 4, and it is exactly the class where the incumbents
scored zero.

#### Saying it out loud — lead with the consequence, never the mechanism

The technical version above is for the interview. On camera, **nobody should need to know what an
MCP tool definition, a connection pool, or row-level security is.** A partner has ten seconds and
no context. The story is not *"an unscoped Postgres pool behind a correctly-scoped tool
definition."* The story is *"a tool that shows you your invoices showed you someone else's."*

Save the mechanism for the follow-up question. That's the moment "two files, both individually
correct, and no scanner reads two files at once" turns from confusing into impressive.

This is the line, and it's now **in the script above as Aadi's second beat**:

> I'm Aadi, CTO. Claude wrote us a tool that shows you your invoices — you give it your ID. We
> approved the diff. Turns out you could give it someone else's. Two files, both correct. Nothing
> checks both.

**Naming Claude is the most important word in the line.** "We built a tool that had a bug" is a
story about two founders being careless. "Claude wrote it, we approved the diff, and it was wrong"
is a story about **the entire market you're selling into** — and every partner watching shipped
Claude-written code this week. It converts your anecdote from an admission into a demonstration,
and it makes the video's first sentence ("we find vulnerabilities in AI-generated code") something
you've *lived* rather than something you've *identified*.

Say "Claude," not "an AI" or "our agent." Specificity is what makes it land, and it's accurate —
you ship with it daily.

One thing to keep out of your tone: this is not a complaint about Claude. The framing is *this is
what AI-written code does at scale, including ours.* The line already does that work, because
**you approved the diff** — that clause is what stops a partner thinking "review it more
carefully." It says human review was applied and human review could not see it, which is the
entire reason the product exists.

The rest of the construction:

- **"shows you your invoices… you give it your ID… someone else's."** Same small words three
  times, then the turn. The repetition sets the expectation the last clause breaks. No jargon
  anywhere, and nothing to mispronounce under camera nerves.
- **"Turns out"** is how a person actually says this to a friend, which is the register YC asks
  for. It carries mild self-deprecation without grovelling.
- **"Two files, both correct."** Four words doing all the technical work — it tells a partner the
  bug was invisible to review without saying "cross-surface" or "static analysis."
- **"Nothing checks both."** Plain statement of the gap, handing off to Pranav's survey and then
  the benchmark numbers, which prove it with data instead of asserting it.

**Cost:** 37 words vs the 31 it replaces. Paid for by cutting *"I built security infrastructure at
an AI company"* from Pranav's opener (−8), which the anecdote now outperforms at the same job.
Script lands at **179 words, 57.7s** — slightly *more* slack than before.

**Alternative last line** if you want memorable over plain: *"Two files, both correct. The bug was
in between."* Say each aloud twice and keep whichever doesn't make you feel like you're reciting.

#### Before you say it — the honesty check

I've given you the technical shape of a real class from your corpus. Whether it happened to **you**
is yours to confirm. Say it only if all three are true:

- You shipped a tool (or endpoint) whose name/description implied per-user or per-tenant scoping.
- The client behind it was unscoped — admin pool, service-role key, or RLS not enforced.
- It reached a real environment, even briefly. If you caught it in dev, say *"we caught this in
  our own code"* — still a great story, and it's the honest version.

If the details differ, adjust them; don't adopt mine. A partner who asks one follow-up question
about a story you didn't live will hear it immediately, and it would cost you far more than the
anecdote is worth.

#### The anecdote menu — pick whichever actually happened

All five are real classes with fixtures in your corpus. Ranked by how well they work as a story
told out loud. The test each one passes: **an agent ships it confidently, every test still passes,
and a human reviewer approves the diff — because the diff is correct.**

---

**① The Supabase RLS gap — recommended, because it inverts the trope**

You said "Claude leaked my Gemini key" is the boring version. This is its opposite, and that's
exactly what makes it good. Corpus: `corpus/cases/verified/rls-gap/vuln-no-rls/`.

```sql
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  amount numeric
);
```

That's the whole bug. There's a `tenant_id` column — the schema *knows* about tenants. What's
missing is two more statements: `alter table invoices enable row level security;` and a policy.

**Why an agent ships it:** you asked for a schema and got a correct schema. RLS is a *separate*
statement in a *separate* mental step that nobody prompts for, and the app is fully functional
without it — every page renders, every test passes, every row comes back. There is no failing
signal anywhere.

**Why it's worse than a leaked key:** your Supabase anon key is *supposed* to be public. It ships
in your client bundle by design; Supabase documents this. The thing that actually protects the
data is the policy — and there is no policy. So anyone opens devtools, copies the key that was
never a secret, and reads every tenant's rows straight off the REST endpoint.

**Your own survey backs it:** `rls-gap` appears in 20 of 168 repos and accounts for **681
production findings** — the largest single class in the whole study.

> **On camera (~32 words, ~10s):** Claude wrote my Supabase schema — right tables, right columns,
> no row-level security. My anon key is public by design, that's fine. With no policy behind it,
> anyone could read every user's rows.

The line that lands: *"Everybody tells the leaked-key story. Mine was the opposite — the key was
supposed to be public. There was just nothing behind it."*

---

**② The one-character bind — most visceral, and you have the number for it**

Corpus: `corpus/cases/verified/unauth-mcp-transport/vuln-open-sse/`.

```ts
server.listen({ host: "0.0.0.0", port: 8080, transport: "sse" });
```

**Why an agent ships it:** you said "I can't connect to it from my other machine." Binding
`0.0.0.0` instead of `127.0.0.1` is the correct, universal, top-of-StackOverflow answer to that
sentence. It fixes the problem you asked about. Then it gets deployed.

**Blast radius:** every tool on that server — file reads, database queries, whatever you wired up —
is callable by anyone who finds the port, with no authentication. Shodan indexes it.

**Why this one is strong for you specifically:** it's the exact class behind your headline number.
`unauth-mcp-transport` is 18 of 168 repos. You can say *"one in nine public MCP servers is doing
this right now — and once, so were we,"* which welds your anecdote to your survey in a single
breath. That's the tightest link between personal story and measured evidence available to you.

> **On camera (~30 words, ~10s):** Our MCP server wouldn't take connections, so we moved it off
> 127.0.0.1 to 0.0.0.0. One character. Every tool on it was on the open internet, no auth.

---

**③ The scoped tool on an unscoped client — most *yours***

The full writeup is above. Strongest on differentiation (no incumbent can reach it, it's your
Constitution principle 4), slightly harder to land in ten seconds because it requires holding two
files in your head at once.

---

**④ The dependency that was never pinned**

Corpus: `corpus/cases/verified/unpinned-dependency/vuln-star-range/`.

```json
{ "dependencies": { "left-pad": "*", "some-helper": "latest" } }
```

**Why an agent ships it:** it doesn't know what the current version is, so it writes the thing that
always resolves. `"*"` and `"latest"` are the semantically safest strings available to a model with
no registry access.

**Blast radius:** your build pulls whatever is newest, forever, with no code change and nothing in
any diff. That includes a version published after a maintainer's account is taken over — which is
the delivery mechanism for most of the npm supply-chain incidents of the last three years.

**Honesty constraint:** Gatepass catches **unpinned**, not **hallucinated**. Your own detector
comment is explicit that live registry-existence checks are a separate online pass. Do not tell
this as a slopsquatting story unless you've shipped that pass — say "unpinned," which is what you
measure.

---

**⑤ The confused deputy — best pure "oh no" reaction**

Corpus: `corpus/cases/research/confused-deputy/vuln-forwards-auth/`.

```ts
return await fetch(params.url, { headers: { authorization: req.headers.authorization } });
```

**Why an agent ships it:** two individually reasonable instructions — "let the tool take a URL"
and "make it authenticate against our internal API" — compose into a credential-harvesting
endpoint. Neither instruction is wrong. The composition is.

**Blast radius:** anyone points your tool at a server they control and collects your token.

Excellent story; the only reason it isn't ranked higher is that it needs one extra sentence to
explain *why* forwarding the header was reasonable in the first place, and you're paying by the
second.

### Why the customers moved to Pranav's beat

Two reasons, both about flow. It gives Pranav's fifth beat a real length instead of a stubby
five-second fragment, and it puts *"anyone can rerun our numbers"* immediately after the customer
names — so the beat lands as **"here's who uses it, and you don't have to take our word for any of
it."** That's a much better button than the customer names alone.

It also frees Aadi's block to be nothing but the close, which is what you wanted it to be.

### Your close — kept, with two words changed

Your version: *"We're building Gatepass to be the best security auditing tool in the world, and we
want YC to be a part of our journey."*

I've changed **"auditing tool" → "security scanner."** This one is substantive, not stylistic:
your own Constitution (principle 6, "Pure Software") explicitly rejects being an audit or
compliance company — evidence export is a feature, there is no services tier. Saying "auditing
tool" on camera describes a company you've deliberately decided not to build, and a partner who
then reads your one-pager finds the two don't match.

I've changed **"to be a part of our journey" → "building it with us."** I flagged "journey" once
and you kept it, so this is your call and the line below is ready to drop in verbatim. My reason,
stated once and then I'll stop: it's the register partners have heard 24,000 times, and it asks
where the rest of your script tells. Either version works — the script is strong enough to carry
it.

> **Your exact close, if you prefer it (+7 words, pushes to 60.0s at 3.1 w/s — time a take):**
> Pranav and I have been building together since 2023. We're building Gatepass to be the best
> security auditing tool in the world, and we want YC to be a part of our journey.

### Naming Skaptix and ZiliconCloud — worth it, with one thing to prepare

Earlier in this file I argued unrecognised names cost words and buy nothing. Naming them changes
that, because it converts an abstraction into something checkable: "two companies" is what someone
says when it's one company and a friend. Two named companies with full-product usage is a
different claim.

**Say "across every feature we ship" only if it's true today.** That phrase commits you to the PR
comments and the CI gate, which are the flagship developer motion — and `GO-TO-MARKET.md`'s own
"not built" list still says *"GitHub App not wired to a live install — PR comments and check runs
are coded but never posted to a real repo."* If that's stale, delete the line from that file. If
it's still accurate, drop to a version you can defend:

| If true today | Say |
|---|---|
| PR comments + CI gate live in their repos | "…run Gatepass in CI on every pull request." ← strongest available |
| Full product, as you told me | "…run Gatepass on their code today, across every feature we ship." |
| Scanning, but not yet in their PR flow | "…run Gatepass on their code today." |

**Prepare the ZiliconCloud question.** You worked there. A partner who spots that after you
presented it as arm's-length validation reads it as a rounded-up number; a founder who says
*"one of them is where I used to work — they knew the problem, which is why they said yes first"*
reads as someone with distribution. Same fact, opposite inference. It doesn't fit in sixty
seconds, so keep it for the interview and the written application — but never let them find it
before you say it.

### On saying "high school" — I'm revising my earlier advice

Earlier in this file I said don't mention school at all. That was too blunt. The rule I'd actually
apply: **name it only where it amplifies an achievement, never as a standalone fact or a caveat.**
"We're in high school, so…" is the frame that costs you. "One of nine high-school teams in the
country" is the frame that wins. Neither appears in the final script above, but it governs the
written application and the interview. §7 keeps the rest of that guidance intact.

### Claims that did NOT survive fact-checking — never say these

These appeared in earlier drafts. All three are checkable by a partner in about a minute.

| Never say | Why |
|---|---|
| **"We ran CodeQL" / "CodeQL catches zero"** | **CodeQL was never executed.** It's configured in `benchmark/src/run-incumbent.ts` but has no result row and no report file; `COMPETITIVE-BENCHMARK.md` scores only Semgrep, Gitleaks, Trivy and Snyk. An unmeasured claim about GitHub's own tool, in a pitch about measurement discipline. |
| "MARS beats the search behind every world-class chess engine" | Stockfish is alpha-beta + NNUE. Your baseline was an MCTS sharing your eval network. Say "beats Monte-Carlo tree search 88.5% of games at 70% of the compute" — precise, and stronger for it. |
| "1.55× throughput on the same compute" | Your writeup says ~70% of opponent wall-clock, which is 1.43×, and it's latency, not throughput. |

### Say "servers," never "companies"

The survey covered **168 public MCP server repositories**, discovered via the GitHub search API.
Many are individual or OSS projects, not companies. "We scanned 168 companies" is the one sentence
in this video a partner could catch as an overstatement, and it would cost you far more than the
word is worth. "Public MCP servers" is both accurate and more impressive — it says you went and
measured the ecosystem.

Same discipline on "one in nine": 18 of 168 is 10.7%, which is one in 9.3. Your own published
report already says "roughly one in 9," so the phrasing is consistent with something a partner can
open and check. Do not let it drift to "one in eight."

"Nearly half" is **44.6%** — 75 of 168 repos with a verified finding in production code. That
rounds honestly to "nearly half" and a partner opening the report sees 44.6%, so the two agree. If
you'd rather carry zero rounding risk, say **"forty-four percent"** — it costs one word and is
unimpeachable. Do not say "half."

The two numbers are doing different jobs and the order matters. "Nearly half" answers *is this
widespread?* "One in nine, no authentication" answers *is it serious?* Severity lands last on
purpose — an unauthenticated transport is a live exposure that needs no explanation, whereas "a
verified finding" invites "what kind?" (Answer, if asked: RLS gaps in 20 repos, CORS in 48,
unpinned deps in 16, exposed secrets in 10 — all verified-tier, all with machine-checked
reproductions, test paths excluded.)

### Say the truest version of the pilot line

That beat is now the most valuable eight seconds in the video, so spend them on the most specific
true statement. In descending order of strength — use the highest one that is honestly true:

| If it's true | Say |
|---|---|
| It's in their CI, gating merges | "Two companies have Gatepass gating their pull requests." |
| It has caught a real issue | "Two companies are running Gatepass in pilot — it's already caught things before they shipped." |
| They're paying | "Two companies are paying us to run Gatepass on their code." |
| Baseline (in the script above) | "Two companies are running Gatepass on their code right now." |

Do not upgrade past what's true. A partner who probes one notch past your claim and finds air has
learned something about the benchmark too — that's Constitution principle 1 applied to your own
pitch. Naming the companies is only worth the words if a partner would recognize them; otherwise
"two companies" is stronger than two unknown names.

### If you run long

182 words is 59s at the 3.1 words/sec measured off accepted videos, but 63s if you settle to a
calmer 2.9. **With your preferred close it's 61s at 3.1 and 66s at 2.9** — that version has no
slack, so time a take before you commit to it. Trim in this order; each cut is clean and costs
nothing structural:

1. "on the transport at all" → "at all" (Pranav 2) → −3 words
2. "So we measured ourselves against the field" → "So we measured ourselves" (Aadi 2) → −3 words
3. "every finding shipping with a reproduction that has to run" → "every finding carrying a
   reproduction that runs" (Aadi 2) → −3 words
4. "Our corpus, benchmark and survey are all public — anyone can reproduce the numbers"
   → "Corpus, benchmark and survey are public — reproduce them yourself" (Pranav 3) → −4 words
5. "I built security infrastructure at an AI company" → cut entirely (Pranav 1) → −8 words

Items 1–4 buy back thirteen words, about four seconds — enough to cover the long close. Item 5 is
the reserve parachute, and it costs less than it used to: the invoices story now does the
founder-market-fit work that credential was doing.

Do **not** trim the invoices story, the customer names, the 12-class line, or the survey numbers.
Those four are the video.

If you're badly over, the reserve parachute is *"I built security infrastructure at an AI
company"* (−8 words, ~2.5s). It's real founder-market fit and I'd rather you kept it, but it's the
only clause whose removal doesn't break the arc.

---

## 4. The bullet card — this is what you hold off-camera

Print it. Do not read it. Learn the beats, then talk.

**PRANAV**
1. Pranav, CEO, Gatepass · security infra at an AI company
2. vulns in AI-generated code **+** the agents — MCP servers, tool defs, permission scopes
3. **"we went and counted"** → **168 public MCP servers** → **nearly half** a real prod vuln →
   **1 in 9** no auth on the transport
4. **Skaptix + ZiliconCloud** run it today, **every feature we ship**
5. corpus + benchmark + survey **all public — anyone can reproduce the numbers**

**AADI**
1. Aadi, CTO
2. **the invoices story** — tool shows you *your* invoices · you give it *your* ID · **turns out
   you could give it someone else's**
3. **"two files, both correct. nothing checks both."**
4. **"so we measured ourselves against the field"** → 12 classes: Semgrep **1**, Gitleaks **1**,
   Trivy **0**, us **12**, zero FPs
5. every finding ships with a reproduction that **has to run**
6. building together **since 2023**
7. close: **best security scanner in the world — we want YC building it with us**

---

## 5. Fact check — every number above, verified against this tree

| Claim | Source | Status |
|---|---|---|
| 168 public MCP servers scanned | `research/out/mcp-survey-aggregate.json` — 300 discovered, 122 excluded as not-actually-MCP, 10 clone failures, **168 scanned** (119,868 files), measured 2026-07-26 | ✅ exact |
| "Nearly half had a real vulnerability in production" | `reposWithProductionFinding: 75` of 168 = **44.6%**. Verified-tier only (machine-checked reproduction), test/example paths excluded, deterministic engine with `semanticEnabled=false` | ✅ — "forty-four percent" if you want zero rounding risk |
| "One in nine had no authentication on the transport" | `byClassProduction.unauth-mcp-transport` = **18 repos**, 41 findings. 18/168 = **10.71%** = 1 in 9.33. Test/example paths excluded; 10/10 random re-check confirmed at recorded commit SHA | ✅ — matches the published report's "roughly one in 9" |
| "Those three catch one between them" | `benchmark/COMPETITIVE-BENCHMARK.md`, measured 2026-07-23: Semgrep 1/12 (*"only the AWS key"*), Gitleaks 1/12 (*"only the AWS key"*), Trivy 0/12. Same class both times, so the **union is exactly 1 of 12** | ✅ exact — and stronger phrasing than listing them |
| Gatepass 12/12 @ 0% FP | same file, identical scoring pipeline | ✅ exact |
| **CodeQL** | Configured in `benchmark/src/run-incumbent.ts` but **never executed** — no row in the results table, no report file | ❌ **DO NOT SAY IT.** Unmeasured claim about GitHub's own tool |
| MARS: beats MCTS 88% of games at 70% of compute | Your writeup: 88.5% over 100 games, +360 Elo, p≈0.05, ~70% of opponent wall-clock, vs an MCTS baseline sharing the identical eval network | ✅ — but say **"Monte-Carlo tree search,"** never "every world-class chess engine" (Stockfish is alpha-beta + NNUE) |
| NASA SLI: 1 of 9 high-school teams, first in the nation | Your profile: selected 1 of 9 nationwide; 1st Place Scientific Payload | ✅ — "first in the nation" refers to the payload award; say *"first in the nation"* not *"best team in the nation"* |
| "Building together since 2023" | Challenger Coding: you from Oct 2023, Pranav listed from Sep 2025 | ⚠️ **verify.** If the joint web-dev work started in 2023, it's fine. If the first genuinely joint project was later, say that year instead — it costs nothing and this is an easy thing to be caught rounding |
| Verified findings carry a machine-checked reproduction | `packages/findings` schema + `corpus/harness/measure.ts` fails the run otherwise | ✅ |
| Corpus + benchmark public | `corpus/`, `benchmark/published/` | ✅ |
| Skaptix + ZiliconCloud running Gatepass, "across every feature we ship" | founders, July 2026 | ⚠️ **you own this one.** "Every feature" commits you to PR comments + CI gate; `GO-TO-MARKET.md` still lists the GitHub App as never wired to a live install. Either that file is stale (fix it) or drop a tier — see the §3 table |
| 75 sites / $150K | your profile, "alongside co-founder" | ⚠️ **cut from the script** — displaced by the credentials and the origin story. Still your best answer in the interview to "have you two shipped together before?", and it needs the same joint-attribution check before you say it |

The previous draft of this file said "Semgrep, Gitleaks and Trivy… each of them caught one."
Trivy caught **zero**. Corrected — and the corrected version is rhetorically stronger anyway.
It also said 34K lines; the tree is now 44,495 lines of TS/TSX.

**Cut from the script, deliberately:** "zero to working scanner in eighteen days." True (first
commit 2026-07-09 → 2026-07-27), and it was the traction stand-in while there were no users. The
pilots are strictly better evidence, and 44K lines in 18 days invites "did AI write this?" in a
video where you get no chance to answer. Keep it loaded for the interview — the answer there is
good — but it doesn't earn eight of your sixty seconds now.

---

## 6. On the Startup School line — my recommendation is **cut it**

You asked specifically. I checked, and the honest answer changed my mind against including it.

Startup School 2026 (July 25–26, Chase Center, SF) was genuinely selective and in-person — YC
hand-selected and flew out roughly **6,000 people from 30,000+ applicants**. So it is not
nothing; it is about a 1-in-5 selection.

But weigh that against what the same three seconds buys elsewhere. YC's batch acceptance is
~1% of ~25,000 applicants. A partner hearing "YC selected me for Startup School" learns that you
cleared a bar 20× wider than the one they're currently judging — and they know the exact number,
because it's their event. Meanwhile "Semgrep caught one of twelve, we caught twelve" is a fact
about *your product* that nobody else in the pile can say.

There's a second-order risk too: naming YC's own event back to YC, in a 60-second video, can read
as signalling affinity rather than substance. That's a small risk, but it is asymmetric — there's
no upside case where this line is the thing that gets you in.

**Where it belongs:** the education section of the written application, where it's free. It's
already there. Leave it there.

If you disagree and want it in, the only version I'd allow is a trailing clause on Aadi's last
beat, never a standalone sentence — the moment it stands alone it inverts:

> …building together since 2023. YC flew me out to Startup School last week. We're building this
> either way.

Pay for the words by cutting "in revenue" and "at all" per the trim list in §3. Note that this now
costs you more than it did before: with the survey in, every second is carrying measured evidence,
and this is the only line in the video that carries none.

---

## 7. Two things I'd flag honestly

**1. Two pilots is thin — but the survey is now doing the heavy lifting, and that's the right split.**

For scale: Suggestr had 17 brands and $7K generated. Prolific had $500K monthly GMV. Virtually had
six paying customers. Two pilots sits below that bar and a partner will read it as early rather
than proven.

The survey is what makes that survivable. Two pilots alone is a weak answer to "does anyone want
this?" Two pilots *plus* 168 servers measured in the wild is a different claim: you didn't guess
that the problem exists, you went and counted it, and then two companies acted on it. That
sequence — evidence, then demand — is much harder to dismiss than either half alone.

Say the pilot line plainly, no adjectives. Two pilots described accurately reads as honest early
traction; two pilots inflated into "customers" reads as a team that rounds up, which is a far worse
thing to be in a pitch whose entire premise is false-positive discipline.

Naming Skaptix and ZiliconCloud helps here — it's the difference between a number and a fact. But
it also means a partner can look them up, so go in having already decided how you describe the
ZiliconCloud relationship (§3). Volunteering it costs you nothing and being caught by it costs you
the credibility the rest of the video is built on.

**Between now and filming, the highest-value work is upgrading that one sentence, not the script.**
Getting either pilot to (a) put Gatepass in CI, (b) confirm it caught something real before it
shipped, or (c) pay anything at all moves you a full tier up the §3 table. Your own
`GO-TO-MARKET.md` says it: *"A $500/mo customer at application time beats 50 free users."*

**Hold in reserve for the written application and the interview** — these don't fit in sixty
seconds, but they're your best answers to "is the market real?":

- **52.4%** counting test paths, against the 44.6% you say on camera. You are quoting the
  conservative cut of your own data, and saying so when asked is a credibility argument in itself.
- 1,327 production verified findings across 119,868 files, every one carrying a machine-checked
  reproduction, with a 10/10 random re-verification at recorded commit SHAs.
- Class breakdown behind "nearly half," if a partner pushes on severity: CORS 48 repos, RLS gaps
  20, unpinned deps 16, exposed secrets 10, unauthenticated MCP transport 18. The 1-in-9 line is
  that last row, and it's the one you lead with precisely because it needs no explaining.
- The survey is also a **lead list**: `pnpm research:leads` segments it into priority accounts, and
  `GO-TO-MARKET.md` calls the disclosure list your #1 asset. "168 scanned, 18 with a live exposure,
  2 already in pilot" is a funnel, not a TAM slide — and a funnel is what a partner is actually
  listening for.

### The bug to tell when they ask "has this bitten you?"

Doesn't fit in sixty seconds. It is the best thing you can have loaded for the written application
and the interview, because it turns "the bugs live in between" from a claim into a story. Both
examples below are real fixtures in this repo — a partner can open them.

**Use only the one that actually happened to you.** The value is entirely in it being your own
scar; a borrowed anecdote falls apart on the first follow-up question.

#### Primary: the scoped-looking tool over an unscoped client

`corpus/cases/cross-surface/cross-surface-scope-mismatch/vuln-scoped-tool-unscoped-client/`

```jsonc
// mcp/tools.json
{ "name": "get_user_invoices",
  "description": "Returns the user's invoices.",
  "parameters": { "userId": { "type": "string", "maxLength": 64 } } }
```
```ts
// src/db.ts
export const db = new Pool({ connectionString: process.env.DATABASE_URL });
```

Neither file is wrong. The tool is named per-user, described per-user, and its one parameter is a
bounded string — that is what a correct tool definition looks like. The pool is four lines out of
the `pg` README. Review either file alone and you approve it.

The bug only exists in the relationship: **`userId` looks like an authorization boundary and is
not one.** It's a parameter the *model* fills in, from text the *user* wrote, and the query behind
it runs on a connection with no tenant binding and no RLS. Pass someone else's id and you get
someone else's invoices. Cross-tenant read, shipped by a diff where every hunk was defensible.

Why an AI writes it: you ask for a tool that returns a user's invoices, and it writes exactly
that — correctly, in the file you were looking at. It has no reason to go re-read how `db` was
constructed three directories away, and neither did you during review.

Why nothing else catches it: a SAST pass over `db.ts` sees an ordinary pool. A tool-definition
linter over `tools.json` sees a well-formed bounded tool. **You have to hold both files at once,
and no other scanner does.** That is the whole cross-surface argument, delivered as an anecdote
instead of an assertion.

#### Backup: the handler that forwards your caller's credential

`corpus/cases/research/confused-deputy/vuln-forwards-auth/tree/mcp/handler.ts`

```ts
export async function handler(req: Request, params: { url: string }) {
  const incomingAuth = req.headers.authorization;
  return await fetch(params.url, { headers: { authorization: incomingAuth } });
}
```

Six lines that read like a helpful generic fetch tool, and close to what you get if you ask an
agent for one. But `params.url` is model-controlled and `incomingAuth` is the caller's real
bearer token, so the first prompt that talks the model into a URL you don't own exfiltrates that
credential. Nothing here is a code smell — the file has no injection, no eval, no hardcoded
secret. It is a trust-boundary bug wearing the clothes of a utility function.

Easier to tell out loud than the primary (one file, one sentence of consequence), so it's the
better choice if you're short on time. Weaker strategically, because a single-file scanner could
in principle be taught this one — it doesn't demonstrate the moat.

#### One correctness note before you say either of these

Both classes are **research tier**, not verified — confidence-scored, no machine-checked
reproduction (`HANDOFF.md` §4). Say "Gatepass flags this" and never "Gatepass verifies this." If
you specifically want a *verified*-tier scar, use `rls-gap`: it's deterministic, and it was the
highest-volume class in your own survey at 681 production findings across 20 repos.

**2. Do not say your age, and do not mention school.** It's visible on camera. Stating it invites
the frame Paul Graham has been publicly skeptical about, and YC's own position is that age is
neither a penalty nor a bonus. Dense, specific, unhedged technical content coming out of two
people who look sixteen does the work far better than any sentence about it could. Let the
contrast land by itself.

**Interview prep, not video content:** your own benchmark honestly records that a frontier LLM
ties you on detection over this corpus. Do not raise it on camera — but have the answer loaded,
because a technical partner may. The answer is in `COMPETITIVE-BENCHMARK.md` and it's a good one:
determinism (you cannot gate a PR on a coin flip), machine-verified reproductions, and zero
marginal cost per scan.

---

## 8. Production notes

- **One shot, both of you, side by side, one webcam.** Nearly every accepted video does this.
- **No edits, no cuts, no music, no title card, no screen share.** YC says "nothing except the
  founders talking." The demo goes in the demo field.
- Do 6–8 takes. Keep the one that sounds like *talking*, not the one that sounds correct.
- Look at the lens, not at each other's tile. Whoever isn't speaking stays visibly engaged —
  partners are reading whether you two actually like each other.
- Hand off mid-thought, not with a pause. Suggestr's handoffs land inside a beat ("I mean,
  exactly — "), which is why they read as a conversation rather than two solo takes.
- Upload **unlisted** to YouTube with embedding enabled.

---

## 9. Sources

- [YC — The Application Video](https://www.ycombinator.com/video/)
- [YC Application Tips: The Founder Video (Dalton Caldwell)](https://www.youtube.com/watch?v=ia6dMP-8Vgc)
- [Suggestr — YC application founder video (accepted)](https://www.youtube.com/watch?v=BBhAJwgTlZ4)
- [Prolific (YC S19) founder video](https://www.youtube.com/watch?v=l1oq3NavalE)
- [OpenPhone (YC S18) application video](https://www.youtube.com/watch?v=sJygK7R4yP0)
- [MagicBell (YC W21) application video](https://www.youtube.com/watch?v=DSryZAogh30)
- [Dendron (YC W21) founder video](https://www.youtube.com/watch?v=DptIzmBq_iQ)
- [Virtually (YC S20) founder video](https://www.youtube.com/watch?v=P_GSpJ44oxs)
- [Shotput/Derivative (YC S15) application video](https://www.youtube.com/watch?v=HPwBahapz3I)
- [Shizune — 16 accepted YC founder video examples](https://shizune.co/yc-application-examples/founders-video)
- [Pilot — How to prepare for your YC application video](https://pilot.com/blog/how-prepare-yc-application-video)
- [Startup School 2026 — Y Combinator Events](https://events.ycombinator.com/startup-school-2026)
