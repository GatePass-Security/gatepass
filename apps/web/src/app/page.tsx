import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { DetectionSlider } from "@/components/landing/DetectionSlider";
import { HowItWorksInteractive } from "@/components/landing/HowItWorksInteractive";
import { ServicesAccordion } from "@/components/landing/ServicesAccordion";
import { BenchmarkVisualCard } from "@/components/landing/BenchmarkVisualCard";
import { BenchmarkExplorer } from "@/components/landing/BenchmarkExplorer";
import { GatepassLogo } from "@/components/landing/GatepassLogo";
import { Reveal } from "@/components/landing/motion";
import "@/styles/landing.css";

/**
 * Marketing landing page.
 *
 * Every number here is measured on corpus-v2 (192 cases) and regenerable:
 *   pnpm benchmark:matrix                 → 92/93 detection · 0/99 FP
 *   pnpm benchmark:semgrep                → Semgrep 2/12 classes · 5/93
 *   pnpm benchmark:incumbent              → Gitleaks 1/12 · Trivy 0/12 · CodeQL SKIPPED
 *   pnpm benchmark:llm-score              → the blind frontier-LLM baseline
 *   pnpm benchmark:determinism            → byte-identical ×10 · 4.1 ms · 0 tokens
 *   pnpm research:scan-mcp                → 168 servers · 18 affected
 *
 * TWO THINGS THIS PAGE MUST KEEP SAYING OUT LOUD.
 *
 * 1. 98.9% is an UPPER BOUND. Earlier versions led with a clean-room figure — cases written by
 *    authors who had seen neither the detectors nor any fixture — because that predicted a
 *    stranger's repository. Detector work has since had access to all 192 cases, so no population
 *    here is held out any more and the clean-room subset now measures recognition of fixtures we
 *    tuned against. Corpus v1 made exactly this mistake at 12/12 and fell to 26.7% the moment
 *    somebody independent wrote the tests. Quote the caveat with the number, every time.
 *
 * 2. CodeQL has NEVER been measured. A published 0/12 came from `codeql database analyze` pointed
 *    at a source tree, which aborts before reading anything; the runner discarded stderr and read
 *    a report that was never written. Do not restore that row without a run that produced output.
 *
 * See benchmark/COMPETITIVE-BENCHMARK.md.
 */

/** Outbound destinations. Edit these once the real URLs exist. */
const SITE = {
  install: "#start",
  docs: "https://github.com/gatepass-dev/gatepass#readme",
  benchmarkReport: "#benchmarks",
  github: "https://github.com/gatepass-dev/gatepass",
  contact: "mailto:founders@gatepass.dev",
};

const MARQUEE = [
  { src: "/landing/finding.svg", alt: "A verified tool-poisoning finding with its reproduction" },
  { src: "/landing/gate.svg", alt: "A pull request with the Gatepass check blocking merge" },
  { src: "/landing/cli.svg", alt: "Gatepass CLI output listing findings by class" },
  { src: "/landing/coverage.svg", alt: "OWASP ASI coverage grid, four full and one declared gap" },
  { src: "/landing/bench.svg", alt: "Detection benchmark against Semgrep, Gitleaks and Trivy" },
  { src: "/landing/determinism.svg", alt: "Ten consecutive scans producing an identical digest" },
  { src: "/landing/transport.svg", alt: "An unauthenticated MCP transport finding" },
  { src: "/landing/scope.svg", alt: "A cross-surface scope mismatch between an app and its tools" },
  { src: "/landing/survey.svg", alt: "Survey of 168 public MCP servers" },
  { src: "/landing/repro.svg", alt: "The reproduction record attached to every verified finding" },
];

/*
 * Four numbers, each traceable to an artifact rather than to a claim about somebody else.
 *
 * The first used to read "CodeQL detects none of them". It was withdrawn: that run never
 * executed (see the note above COMPARISON). What replaced it says only what our own corpus
 * measured, which is the only thing we can stand behind under questioning.
 */
const STATS = [
  { value: "12 / 12", label: "Agentic vulnerability classes detected across 192 corpus cases" },
  { value: "98.9%", label: "Detection rate — 92 of 93 vulnerable cases, and we publish the miss" },
  { value: "0", label: "False positives across 99 clean cases written to induce them" },
  { value: "1 in 9", label: "Public MCP servers we scanned shipped an agentic vulnerability" },
];

const SERVICES = [
  {
    title: "Tool safety",
    body: "MCP servers, tool descriptions, transports, permission scopes, agent loops — the agentic surfaces traditional scanners were never built for. The engine parses the manifest and the tool together so a finding only fires once the path is real.",
    image: "/landing/transport.svg",
  },
  {
    title: "Code hygiene",
    body: "The mistake patterns AI models reliably make when they scaffold a backend: wildcard CORS with credentials, committed provider keys, tenant tables without row-level security, floating dependency ranges. Same engine, same verdict on every run.",
    image: "/landing/finding.svg",
  },
  {
    title: "Scope integrity",
    body: "Some classes are invisible in any single file. A scope mismatch only exists between the manifest and the tool that exceeds it — so the engine reads the manifest, the tool definition and the call site together before reporting.",
    image: "/landing/scope.svg",
  },
  {
    title: "Audit exports",
    body: "Findings, reproductions and posture export as signed, timestamped records. Contrast ratios are computed, not guessed. Nothing is asserted without a check behind it.",
    image: "/landing/panel-evidence.svg",
  },
];

/*
 * The last column used to be "Cost / Tokens", reading "$0 (0 Tokens)" for us.
 * It was replaced for two reasons. It did not differentiate: Semgrep, Gitleaks
 * and Trivy are also free, so four of eight rows read "$0" and the column
 * settled nothing. And read as a claim about the product it was not true —
 * research-tier semantic analysis calls GLM 5.2 through the Gatepass gateway
 * and does spend tokens. What is true, and true only of us, is that a verified
 * finding cannot exist without a runnable reproduction: the schema in
 * `packages/findings` rejects one that has no reproduction attached, so this
 * column is a structural guarantee rather than a marketing line.
 */
/*
 * Every row here was executed against the same 192 cases (93 vulnerable · 99 clean) on
 * 2026-07-28. `benchmark/published/corpus-v2.json` is the artifact these figures come from, and
 * the publisher refuses to place two tools in one table unless their case counts match exactly.
 *
 * Three rows have been deleted rather than updated, all for the same reason: nothing was behind
 * them.
 *
 *  · CodeRabbit claimed 2/12. The harness skipped it every run for want of an install — and the
 *    `coderabbit` package on npm is a security holding placeholder with no code in it.
 *  · A frontier-LLM row claimed 12/12, from a run that handed the model the twelve class ids and
 *    asked it to pick from them. That is multiple-choice recall, not detection. The fair blind
 *    re-run now exists and lives on the benchmark page, where the population it was measured on
 *    can be stated alongside it; it is not comparable to this table's 192 cases.
 *  · GitHub Advanced Security (CodeQL) claimed 0/12. The harness invoked
 *    `codeql database analyze <source-dir>`, which needs a database rather than a source tree, so
 *    it aborted with "is not a recognized CodeQL database" on every case and the runner recorded
 *    the absent report as zero findings. CodeQL has never been measured here. Publishing 0/12 for
 *    a competitor's product on the strength of a run that read no code is the single worst thing
 *    this table could do, and it did it until someone typed the command by hand.
 *
 * The runner now returns a skip with the reason attached instead of a zero (`run-incumbent.ts`),
 * so a tool that did not run cannot reach this file at all.
 */
const COMPARISON = [
  {
    tool: "Gatepass",
    classes: "12 / 12",
    cases: "92 / 93",
    fp: "0",
    deterministic: "Yes",
    repro: "Every verified finding",
    us: true,
  },
  {
    tool: "Semgrep OSS 1.170.1",
    classes: "2 / 12",
    cases: "5 / 93",
    fp: "1",
    deterministic: "Yes",
    repro: "No",
  },
  { tool: "Gitleaks 8.30.1", classes: "1 / 12", cases: "2 / 93", fp: "1", deterministic: "Yes", repro: "No" },
  { tool: "Trivy 0.72.0", classes: "0 / 12", cases: "0 / 93", fp: "0", deterministic: "Yes", repro: "No" },
  /*
   * Measured on a different population and labelled as such. The LLM baseline ran on a 24-case
   * draw — one vulnerable and one clean per class — so its recall is not comparable to the 93
   * vulnerable cases above, and the cases column says which population each row belongs to. The
   * "naive prompt" condition is the one a user would actually type; the guided condition, which
   * ties us, is on the benchmark panel rather than hidden.
   */
  {
    tool: "Claude (frontier LLM), naive prompt",
    classes: "12 / 12",
    cases: "12 / 12 · 24-case draw",
    fp: "8",
    deterministic: "No",
    repro: "No",
    population: "sample" as const,
  },
  /*
   * Rows we have NOT measured, kept because a reader comparing tools deserves to see them — and
   * kept without numbers because we do not have any. Every figure this page ever published for
   * CodeQL, CodeRabbit and Greptile came from a harness bug rather than a run (see the panel),
   * so the bar for putting a number back is a run that produced output. Coverage below is each
   * vendor's own public description of what their tool looks for, not our assessment of it.
   */
  {
    tool: "CodeRabbit CLI",
    classes: "Not measured",
    cases: "—",
    fp: "—",
    deterministic: "No",
    repro: "No",
    claim: "Vendor describes SQL injection, exposed secrets, race conditions and leaks, over 40 linters/SAST",
  },
  {
    tool: "Greptile Agent v4",
    classes: "Not measured",
    cases: "—",
    fp: "—",
    deterministic: "No",
    repro: "No",
    claim: "Vendor describes SQL injection, SSRF and unsafe input handling, opengrep rules plus SCA",
  },
  {
    tool: "GitHub Advanced Security (CodeQL)",
    classes: "Not measured",
    cases: "—",
    fp: "—",
    deterministic: "Yes",
    repro: "No",
    claim: "Our run never executed — withdrawn rather than published as a zero",
  },
  {
    tool: "Snyk Agent Scan",
    classes: "Cannot scan source",
    cases: "—",
    fp: "—",
    deterministic: "—",
    repro: "—",
  },
];

function Divider({ index, label }: { index: string; label: string }) {
  return (
    <div className="gp-container">
      <div className="gp-divider">
        <span className="gp-divider-text">
          {index} / {label}
        </span>
        <span className="gp-divider-line" />
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="gp" id="top">
      <LandingNav />

      {/* ─────────────── 01 · Hero ─────────────── */}
      <section className="gp-hero">
        <div className="gp-hero-glow" aria-hidden="true" />
        <div className="gp-container">
          <div className="gp-hero-inner">
            <Reveal>
              <span className="gp-eyebrow">
                <span className="gp-eyebrow-dot" aria-hidden="true" />
                <span>
                  We scanned <b>168 public MCP servers</b>. 1 in 9 shipped a vulnerability.
                </span>
              </span>
            </Reveal>

            <Reveal delay={1}>
              <h1>
                <span className="gp-dim">AI writes the code.</span>
                <br />
                Gatepass decides if it ships.
              </h1>
            </Reveal>

            <Reveal delay={2}>
              <p className="gp-hero-sub">
                A deterministic security scanner for AI-native and agentic codebases. It finds tool poisoning, confused
                deputies, unauthenticated MCP transports and scope mismatches, then blocks them in the pull request.
                Same input, same bytes, every run — no model in the loop.
              </p>
            </Reveal>

            <Reveal delay={3}>
              <div className="gp-buttons-row">
                <a className="gp-btn gp-btn-primary" href="#start">
                  Scan your repo
                </a>
                <a className="gp-btn gp-btn-secondary" href="#benchmarks">
                  See the benchmarks
                </a>
              </div>
            </Reveal>
          </div>
        </div>

        {/* Infinite marquee */}
        <div className="gp-marquee-stage" aria-hidden="true">
          <div className="gp-marquee-row">
            {[0, 1].map((copy) => (
              <div className="gp-marquee-track" key={copy}>
                {MARQUEE.map((item) => (
                  <figure className="gp-tile" key={`${copy}-${item.src}`}>
                    <img src={item.src} alt="" width={320} height={370} loading="lazy" />
                  </figure>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="gp-container">
        <div className="gp-stats" style={{ paddingBlock: "72px" }}>
          {STATS.map((s, i) => (
            <Reveal key={s.value} delay={i}>
              <div className="gp-stat-value">{s.value}</div>
              <div className="gp-stat-label">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </div>

      {/* ─────────────── 02 · Detections ─────────────── */}
      <Divider index="02" label="Detections" />
      <section className="gp-section" id="detections" style={{ paddingTop: 0 }}>
        <div className="gp-container">
          <div className="gp-head">
            <Reveal>
              <h2>
                <span className="gp-dim">Twelve classes</span>
                <br />
                your current scanner misses
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="gp-lead">
                Every one of these ships with corpus fixtures and a published precision measurement. A detector that
                cannot prove its own precision does not merge.
              </p>
            </Reveal>
          </div>

          <DetectionSlider />
        </div>
      </section>

      {/* ─────────────── 03 · How it works ─────────────── */}
      <Divider index="03" label="How it works" />
      <section className="gp-section" id="how" style={{ paddingTop: 0 }}>
        <div className="gp-container">
          <div className="gp-head" style={{ paddingBottom: 0 }}>
            <Reveal>
              <h2>
                <span className="gp-dim">How clients use Gatepass,</span>
                <br />
                from PR check to audit proof
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="gp-lead">
                Gatepass connects as a read-only GitHub App, parses your codebase into 5 distinct surfaces, runs
                cross-surface analysis in milliseconds, and delivers fixes directly into your developer workflow.
              </p>
            </Reveal>
          </div>

          <Reveal delay={2}>
            <HowItWorksInteractive />
          </Reveal>
        </div>
      </section>

      {/* ─────────────── 04 · Services ─────────────── */}
      <Divider index="04" label="Services" />
      <section className="gp-section" id="services" style={{ paddingTop: 0 }}>
        <div className="gp-container">
          <div className="gp-head">
            <Reveal>
              <h2>
                <span className="gp-dim">Surfaces we cover,</span>
                <br />
                with measured precision
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="gp-lead">
                Each capability is a separate detector with its own corpus fixtures and a published precision number.
                Hover any row to see what it actually catches — every finding carries the line and the commit that
                produced it.
              </p>
            </Reveal>
          </div>

          <Reveal>
            <ServicesAccordion items={SERVICES} />
          </Reveal>
        </div>
      </section>

      {/* ─────────────── 05 · Mid CTA ─────────────── */}
      <section className="gp-section" style={{ paddingTop: 0 }}>
        <div className="gp-container">
          <Reveal className="gp-cta">
            <h2 style={{ maxWidth: "22ch", marginInline: "auto" }}>
              <span className="gp-dim">Point it at a repo.</span> See what is in there.
            </h2>
            <p className="gp-lead" style={{ maxWidth: "56ch", margin: "20px auto 32px" }}>
              We will run a scan on your codebase and send you the findings with reproductions attached. No signup, no
              agent installed, nothing written to your repository.
            </p>
            <div className="gp-buttons-row">
              <a className="gp-btn gp-btn-primary" href="#start">
                Scan your repo
              </a>
              <a className="gp-btn gp-btn-secondary" href={SITE.contact}>
                Talk to the founders
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─────────────── 05 · Benchmarks ─────────────── */}
      <Divider index="05" label="Benchmarks" />
      <section className="gp-section" id="benchmarks" style={{ paddingTop: 0 }}>
        <div className="gp-container">
          {/*
            The sidebar entries open in place. Each headline states a limitation, and a reader who
            wanted the argument behind one previously had to leave for the repository and find the
            right markdown file — which is another way of saying nobody did.
          */}
          <BenchmarkExplorer github={SITE.github}>
            <Reveal>
              <h2 className="gp-bench-h2">Every number here ships with the reason to doubt it</h2>
              <p className="gp-bench-p" style={{ marginTop: 16 }}>
                192 cases across 12 classes. Half are vulnerable, half are hard negatives — safe code written to fool a
                pattern matcher, like a redaction test full of credential-shaped strings, a CORS regression test whose{" "}
                <em>title</em> is a sentence about wildcards, or schema constraints reachable only through a{" "}
                <code>$ref</code> in another file. Identical corpus, identical scoring, every tool at a pinned version.
              </p>
              <p className="gp-bench-p" style={{ marginTop: 16 }}>
                Most of the corpus was written by authors forbidden from reading our detectors, and told that fixtures
                which defeat us are a good outcome. Many of them did.{" "}
                <strong>
                  All 192 cases were then visible while we closed the gaps, so 98.9% is an upper bound on your
                  repository, not a prediction of it.
                </strong>{" "}
                A fresh set written by authors who have seen none of this is what would make the figure transferable,
                and until that exists we say so everywhere the number appears.
              </p>
            </Reveal>

            <Reveal delay={1}>
              <h3 className="gp-bench-h3">192-case scoring matrix</h3>
              <div className="gp-table-wrap" style={{ marginTop: 16 }}>
                <table className="gp-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Classes with a detection</th>
                      <th>Vulnerable cases</th>
                      <th>False positives</th>
                      <th>Deterministic</th>
                      <th>Runnable reproduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON.map((row) => (
                      <tr
                        key={row.tool}
                        className={row.us ? "gp-row-us" : undefined}
                        data-basis={row.claim ? "unmeasured" : undefined}
                      >
                        <td style={{ fontWeight: row.us ? 600 : 400 }}>
                          {row.tool}
                          {/* The vendor's own words, attributed. A capability a company
                                advertises is a fact about their marketing, which is all we can
                                honestly assert without having run the tool ourselves. */}
                          {row.claim && <span className="gp-claim">{row.claim}</span>}
                        </td>
                        <td className="gp-num" style={{ color: row.us ? "var(--accent)" : undefined }}>
                          {row.classes}
                        </td>
                        <td className="gp-num">{row.cases}</td>
                        <td className="gp-num">{row.fp}</td>
                        <td className="gp-num">{row.deterministic}</td>
                        <td className="gp-num" style={{ color: row.us ? "var(--accent)" : undefined }}>
                          {row.repro}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>

            <Reveal delay={2}>
              <h3 className="gp-bench-h3">What this does and does not prove</h3>
              <p className="gp-bench-p" style={{ marginTop: 16 }}>
                We cover twelve agentic vulnerability classes. On the same 192 cases, Trivy covers none of them,
                Gitleaks one, and Semgrep two. That gap is the reason to use us, and it widened rather than closed as
                the corpus got larger and considerably meaner.
              </p>

              <ul className="gp-bench-bullets">
                <li>
                  <strong>Detection:</strong> 92 of 93 vulnerable cases. The one miss is an audit table with no tenant
                  column, and we publish it by name — closing it meant trading away a guard that keeps two legitimate
                  global lookup tables quiet, which was not a trade worth making.
                </li>
                <li>
                  <strong>Precision under pressure:</strong> zero false positives across 99 clean cases built
                  specifically to trip a pattern matcher. This is the figure least affected by having seen the corpus —
                  hard negatives punish a rule that overfits.
                </li>
                <li>
                  <strong>Against a frontier model:</strong> on 24 cases scored identically, an unguided LLM matches our
                  recall and returns eight false positives to our zero. Handed the twelve class names up front it ties
                  us exactly — we publish that row too, because deleting the one condition where a competitor draws
                  level is the whole failure mode this page exists to avoid.
                </li>
                <li>
                  <strong>Evidence that holds:</strong> 111 verified findings, zero we could not reproduce. A finding
                  reaches the verified tier only when its cited file and line re-check against source; anything
                  unprovable is filed as research with a confidence score instead.
                </li>
                <li>
                  <strong>No model in the merge gate:</strong> byte-identical output across ten runs, so a CI build
                  never flips on model temperature. Research-tier semantic analysis is the one path that calls a model,
                  it only adjusts confidence on findings already flagged unproven, and you can switch it off per
                  organisation.
                </li>
              </ul>

              <blockquote className="gp-bench-quote">
                We published CodeQL at zero of twelve. The command was wrong — it needed a database and we handed it a
                source tree — so it aborted on every case, and a harness that discarded errors recorded the silence as a
                score. Four bugs like that surfaced in one week. Every one made a competitor look worse and us look
                better. The numbers are withdrawn and the harnesses can no longer express “did not run” as “found
                nothing”.
              </blockquote>

              <BenchmarkVisualCard />

              <div style={{ marginTop: 20 }}>
                <a className="gp-link" href="#benchmarks">
                  Read the full method and re-run it yourself
                  <ArrowUpRight size={16} />
                </a>
              </div>
            </Reveal>
          </BenchmarkExplorer>
        </div>
      </section>

      {/* ─────────────── 06 · Start ─────────────── */}
      <Divider index="06" label="Get started" />
      <section className="gp-section" id="start" style={{ paddingTop: 0 }}>
        <div className="gp-container">
          <Reveal className="gp-cta">
            <h2 style={{ maxWidth: "20ch", marginInline: "auto" }}>
              <span className="gp-dim">Find out what your</span> agents are actually exposing
            </h2>
            <p className="gp-lead" style={{ maxWidth: "54ch", margin: "20px auto 32px" }}>
              Install takes a minute and reads nothing but your source. If we find nothing, you have a measurement that
              says so.
            </p>
            <div className="gp-buttons-row">
              <a className="gp-btn gp-btn-primary" href={SITE.github} target="_blank" rel="noreferrer">
                Get started on GitHub
                <ArrowUpRight size={18} />
              </a>
              <a className="gp-btn gp-btn-secondary" href={SITE.contact}>
                Contact sales
              </a>
            </div>
            <p className="gp-small" style={{ marginTop: 28 }}>
              contents:read · pull_requests:write · checks:write. Never contents:write.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ─────────────── Footer ─────────────── */}
      <footer className="gp-footer">
        <div className="gp-container">
          <div className="gp-footer-grid">
            <div>
              <span className="gp-nav-logo" style={{ marginBottom: 16 }}>
                <span className="gp-nav-mark" aria-hidden="true">
                  <GatepassLogo size={60} />
                </span>
                Gatepass
              </span>
              <p className="gp-small" style={{ marginTop: 16, maxWidth: "34ch" }}>
                Precision application security for the AI-native stack. Deterministic by construction, and measured in
                public.
              </p>
            </div>

            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <Link href="/dashboard">Dashboard</Link>
                </li>
                <li>
                  <a href="#detections">Detections</a>
                </li>
                <li>
                  <a href="#how">How it works</a>
                </li>
                <li>
                  <a href="#services">Surfaces</a>
                </li>
                <li>
                  <a href="#start">Get started</a>
                </li>
              </ul>
            </div>

            <div>
              <h4>Evidence</h4>
              <ul>
                <li>
                  <a href="#benchmarks">Benchmarks</a>
                </li>
                <li>
                  <a href="#services">MCP security survey</a>
                </li>
                <li>
                  <a href="#benchmarks">Precision report</a>
                </li>
                <li>
                  <a href="#services">Compliance</a>
                </li>
              </ul>
            </div>

            <div>
              <h4>Company</h4>
              <ul>
                <li>
                  <a href={SITE.docs} target="_blank" rel="noreferrer">
                    Documentation
                  </a>
                </li>
                <li>
                  <a href={SITE.github} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href={SITE.contact}>Contact</a>
                </li>
                <li>
                  <a href={SITE.contact}>Support</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="gp-footer-bottom">
            <span className="gp-small">© {new Date().getFullYear()} Gatepass. All rights reserved.</span>
            <span className="gp-small">Every number on this page is regenerable from the repository.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
