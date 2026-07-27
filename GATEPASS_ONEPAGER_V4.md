# GATEPASS (v4 — synthesis)
### Precision application security for the AI-native stack.
**The code AI writes, and the agents it powers — scanned with verified precision, fixed in the developer's own workflow.**

---

## One sentence
**Gatepass is the AppSec platform built for what AI-native startups actually ship: AI-generated application code and the agentic infrastructure (MCP servers, tool configs, autonomous loops) around it — the two attack surfaces where traditional scanners are blind and the new scanners are noise.**

## The problem: two colliding attack surfaces, no serious tooling
AI-native companies ship two things legacy AppSec was never built for:

1. **AI-generated application code**, which holds a stubborn ~45–55% vulnerability incidence even as syntax correctness nears perfection — secrets in bundles, missing tenant isolation, regressed auth, hallucinated dependencies.
2. **Agentic infrastructure**, which is a brand-new attack surface with a brand-new taxonomy: tool poisoning, rug-pull redefinition, confused-deputy OAuth flaws, over-permissioned autonomous loops, prompt-injection surfaces that reach data exfiltration, and hallucination-based vulnerabilities where vague tool definitions cause the model itself to over-privilege. The numbers are staggering: analysis of 2,614 MCP implementations found 82% using path-traversal-prone file operations and 34% command-injection-susceptible APIs; a third of scanned servers carry critical vulnerabilities; hundreds run exposed on the public internet with no auth; RCE-class MCP CVEs (up to CVSS 9.6) are landing monthly; OWASP shipped a dedicated Agentic Top 10 in December 2025; and Gartner projects a quarter of enterprise breaches will trace to AI-agent abuse by 2028.

The tooling response so far splits into two failures. Traditional SAST (Snyk core, Semgrep OSS rules, GHAS) is structurally blind to the agentic classes — a tool-poisoning flaw isn't a code pattern, it's a semantic property of a tool definition interacting with a model. And the first-wave agent scanners (YARA-rule side projects from incumbents and academia) are noise machines: an independent audit found a ~78% false-positive rate, with only 6 of 27 detections representing real issues. Crowded at the toy level; empty at the serious level.

## The product

**1. The scanner — precision as the product.** Static + configuration + semantic analysis across the AI-native stack: application code (framework-aware: Next.js/Supabase/Firebase/FastAPI/Go), agent code, MCP server implementations, tool definitions, and permission scopes. Two honestly separated result tiers:
- **Verified findings:** deterministically checkable issues (exposed secrets, RLS/security-rule gaps, CORS, unpinned/hallucinated dependencies, unauthenticated MCP transports, unbounded tool parameters, missing schema validation) — each shipped with a concrete reproduction.
- **Research-tier findings:** the semantic agentic classes (tool poisoning, HBVs, confused-deputy chains, over-permissioned loops) — confidence-scored, explained, never inflated. We publish our true-positive rate against the incumbent scanners as a standing public benchmark. In a field where the reference tools are 78% noise, *measured precision is the brand.*

**2. Remediation — in the developer's workflow, never behind their back.** No silent CI mutation, no 40-PR flood. Findings arrive where AI-native developers already work: PR comments with suggested diffs the developer approves, IDE annotations, and — opt-in, pre-commit, inside the developer's own loop — structured fix guidance fed to their coding agent (Claude Code, Cursor) so the AI proposes the correction and the human reviews final output. A CI gate can *block*; it never *rewrites*.

**3. Evidence — a feature, not the company.** Scan posture exports as SOC 2/ISO-mapped evidence into Vanta/Drata via API, and auto-drafts the security-questionnaire answers that AI-native startups face in enterprise deals. This rides the compliance platforms' own motion — they ingest scanner outputs; we're the scanner that covers the surfaces their other feeds miss — and it monetizes the deal-unblocking moment without pretending to be a compliance company.

## Who buys
Seed–Series B AI-native companies shipping agentic products (10–150 people, majority-AI-written code, MCP servers in production, no security hire) — plus platform and infra teams at larger companies adopting MCP who need every internal server scanned before it touches production data. The trigger events: a security review probing "how do you secure your AI agents" (now a standard enterprise questionnaire section), an internal MCP rollout, or an incident in the news that looks exactly like their stack.

## Why incumbents don't win this
- **Traditional SAST/scanners:** blind by architecture to semantic agentic classes; retrofitting means building model-interaction analysis from scratch. Their AI-agent offerings to date are open-source side projects, not platform bets.
- **First-wave agent scanners (Cisco mcp-scanner, YARA-based tools):** demonstrably 78% noise; no framework context, no remediation loop, no app-code coverage. They validated the category and set a beatable bar.
- **Runtime agent-security firewalls (Lakera, Prompt Security, Prisma AIRS et al.):** inference-time guardrails — complementary by design. We're pre-deployment; they're runtime. Natural integration partners, and their heavy funding validates the buyer without contesting our layer.
- **Compliance platforms:** ingest scanners; don't build them. We're a feed, not a threat — until we're an acquisition.

## Moat
1. **The agentic vulnerability-research corpus.** The taxonomy is ~12 months old and still being written (HBVs were named this year). Rules are commodity only when the vulnerability classes are settled; here, the moat is discovering and operationalizing classes first — sustained security research, which generic rule-writers don't do.
2. **The public precision benchmark.** Continuously published true/false-positive rates versus incumbent scanners across a versioned open corpus of MCP servers — the trust asset that makes "just write Semgrep rules" insufficient.
3. **Cross-surface context.** Findings that only appear when you analyze app code *and* agent config together (a scoped-looking tool backed by an unscoped database client). Single-surface tools can't see them.
4. **Outcome data:** which findings enterprises' security reviews actually probe, per industry — feeding both ruleset priority and the questionnaire product.

## Business model — pure software
Never per-seat (that taxes adoption of a tool we want every developer running) and never per-scan
(marginal cost is $0, and pricing against our own moat is incoherent). Four tiers, one price each:

- **Free — $0:** the OSS CLI, unlimited local scans, every verified detector, SARIF output. This is
  distribution and benchmark credibility; it never gets gated.
- **Team — $500/mo:** private repos, GitHub App, PR comments, CI gate, up to 10 repos.
- **Scale — $2,000/mo:** unlimited repos, MCP-fleet scanning, Vanta/Drata evidence export,
  questionnaire drafting, research-tier findings.
- **Enterprise — $30–50K/yr:** self-hosted runner, in-VPC semantic layer, SSO, contracted support,
  custom detector classes.

$500 sits deliberately under the threshold where procurement gets involved at a 10–150 person
company — a CTO expenses it, which is the shortest path from conversation to revenue. The $2,000
tier is anchored against the stalled contract it unblocks: ~1% of a $200K deal.

No services tier; internal security research exists to grow the corpus and the benchmark.
Full segmentation, channels, and cadence: [GO-TO-MARKET.md](GO-TO-MARKET.md).

## Why now
The window is 12–18 months old and closing on both ends: OWASP's Agentic Top 10 (Dec 2025) just standardized the taxonomy enterprises will test against; the MCP CVE wave (including CVSS 9.6 RCE in a package with ~500K downloads, and configuration-injection CVEs in Claude Code itself) made the risk concrete to buyers; enterprise questionnaires now contain agent-security sections; and the incumbents' first-wave answers are shallow enough to beat on measured precision — but won't stay shallow forever.

## Founder fit
This is the one pitch where my background isn't adjacent — it's the job description. I build MCP servers and agent systems professionally at ZiliconCloud (B2B AI services: agents, computer vision), and I've done the security side there too: SOC 2 work and SOC pipeline architecture, including event-log vectorization with pgvector/Postgres semantic RAG — detection engineering, in production. I ship daily with AI coding tools as CTO of Thesisly. The agentic attack surface is where my two professional halves — building agents and securing infrastructure — are the same skill.

## End state
The security standard for the AI-native stack. Every company deploying agents eventually asks "are our agents and the code around them safe, and can we show it?" — Gatepass is the scan, the fix path, and the proof. Expansion rulesets (platform reviews, IP provenance) remain future options on the same engine; they are not the pitch.

---

## The 60-second pitch
"AI-native startups ship two things traditional security tools were never built for: AI-generated code — which carries a vulnerability about half the time — and AI agents, a brand-new attack surface where 82% of MCP implementations use path-traversal-prone operations and critical CVEs are landing monthly. Legacy scanners are blind to the agentic classes, and the first-wave agent scanners run at a 78% false-positive rate — the field is crowded with toys and empty of anything serious. Gatepass is the precision AppSec platform for that stack: it scans AI-generated code and agent infrastructure together, separates deterministically verified findings from research-tier ones, publishes its precision as a public benchmark, and delivers fixes as suggestions in the developer's own workflow — PR comments, IDE, or guidance to their own coding agent, with a human approving everything. Compliance evidence exports into Vanta and questionnaire answers come free with the posture. I build MCP servers and agent systems for a living and I've done SOC 2 and SOC-pipeline work at the same company — securing agents is the intersection of both my jobs. We're starting by publicly out-scanning the incumbent tools on their own corpus."
