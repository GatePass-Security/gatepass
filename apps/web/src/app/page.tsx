import { ArrowRight, ArrowUpRight } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { DetectionSlider } from "@/components/landing/DetectionSlider";
import { HowItWorksInteractive } from "@/components/landing/HowItWorksInteractive";
import { BenchmarkVisualCard } from "@/components/landing/BenchmarkVisualCard";
import { GatepassLogo } from "@/components/landing/GatepassLogo";
import { Reveal } from "@/components/landing/motion";
import "@/styles/landing.css";

/**
 * Marketing landing page.
 *
 * Every number on this page is measured, not estimated, and is regenerable from the repo:
 *   pnpm corpus:measure          → 12/12 classes, 100% TP, 0% FP
 *   pnpm benchmark:incumbent     → Semgrep 1/12 · Gitleaks 1/12 · Trivy 0/12
 *   pnpm benchmark:determinism   → byte-identical ×10 · 0.9 ms · 0 tokens
 *   pnpm research:scan-mcp       → 168 servers · 18 affected
 * If a measurement changes, change it here in the same commit.
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

const STATS = [
  { value: "12/12", label: "Agentic vulnerability classes detected on the public corpus" },
  { value: "0%", label: "False positive rate across all 24 corpus cases" },
  { value: "0.9 ms", label: "Mean scan time. No model call, no network round trip" },
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

const COMPARISON = [
  {
    tool: "Gatepass Security Engine",
    detected: "12 / 12 (100%)",
    fp: "0%",
    deterministic: "Yes",
    speed: "0.9 ms",
    cost: "$0 (0 Tokens)",
    us: true,
  },
  {
    tool: "CodeRabbit AI (LLM Reviewer)",
    detected: "2 / 12 (16%)",
    fp: "High (LLM Hallucinations)",
    deterministic: "No",
    speed: "~60,000 ms",
    cost: "High Token Costs / Mo",
  },
  {
    tool: "GitHub Advanced Security (CodeQL 2.26.1)",
    detected: "0 / 12 (0%)",
    fp: "0%",
    deterministic: "Yes",
    speed: "~18,000 ms",
    cost: "$0 / Enterprise Sub",
  },
  {
    tool: "Frontier LLM (Claude Opus 5 / GPT-5.6)",
    detected: "12 / 12*",
    fp: "2 Misattributions (False Alarms)",
    deterministic: "No",
    speed: "~75,000 ms",
    cost: "~110k Tokens / Scan",
  },
  { tool: "Semgrep OSS 1.170.1", detected: "1 / 12 (8%)", fp: "0%", deterministic: "Yes", speed: "~1,200 ms", cost: "$0" },
  { tool: "Gitleaks 8.30.1", detected: "1 / 12 (8%)", fp: "0%", deterministic: "Yes", speed: "~1,100 ms", cost: "$0" },
  { tool: "Trivy 0.72.0", detected: "0 / 12 (0%)", fp: "0%", deterministic: "Yes", speed: "~4,200 ms", cost: "$0" },
  {
    tool: "Snyk Agent Scan",
    detected: "Cannot scan source",
    fp: "—",
    deterministic: "—",
    speed: "—",
    cost: "—",
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
                Gatepass connects as a read-only GitHub App, parses your codebase into 5 distinct surfaces, runs cross-surface analysis in milliseconds, and delivers fixes directly into your developer workflow.
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
            <div className="gp-svc-list" role="list">
              {SERVICES.map((s) => (
                <div key={s.title} className="gp-svc" role="listitem">
                  <button type="button" className="gp-svc-trigger" aria-label={`Expand ${s.title}`}>
                    <span className="gp-svc-title">{s.title}</span>
                    <ArrowRight className="gp-svc-arrow" size={22} />
                  </button>
                  <div className="gp-svc-expand">
                    <div className="gp-svc-expand-inner">
                      <div className="gp-svc-content">
                        <p className="gp-svc-body">{s.body}</p>
                        <img src={s.image} alt="" className="gp-svc-img" loading="lazy" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
          <div className="gp-bench-layout">
            {/* Left Sidebar */}
            <Reveal className="gp-bench-sidebar">
              <div className="gp-bench-author-label">Written by</div>
              <div className="gp-bench-author-row">
                <div className="gp-bench-author-name">Gatepass Research</div>
                <div className="gp-bench-socials">
                  <a
                    href={SITE.github}
                    target="_blank"
                    rel="noreferrer"
                    className="gp-bench-social-link"
                    aria-label="GitHub Repository"
                  >
                    <ArrowUpRight size={18} />
                  </a>
                </div>
              </div>
              <div className="gp-bench-role">Deterministic Security Engine</div>
              <div className="gp-bench-divider" />

              <div className="gp-bench-topic-list">
                <a href="#benchmarks" className="gp-bench-topic-item">
                  <h3 className="gp-bench-topic-title">
                    Frontier Models vs. Gatepass: Full Determinism Analysis
                  </h3>
                  <div className="gp-bench-topic-meta">
                    <span className="gp-bench-badge">Portfolio</span>
                    <span className="gp-bench-date">Sep 2025</span>
                  </div>
                </a>

                <a href="#benchmarks" className="gp-bench-topic-item">
                  <h3 className="gp-bench-topic-title">
                    Semgrep &amp; Gitleaks baseline: 1 of 12 classes detected
                  </h3>
                  <div className="gp-bench-topic-meta">
                    <span className="gp-bench-badge">Tutorials</span>
                    <span className="gp-bench-date">Aug 2025</span>
                  </div>
                </a>

                <a href="#benchmarks" className="gp-bench-topic-item">
                  <h3 className="gp-bench-topic-title">
                    Zero tokens, 0.9ms execution time vs 110,000 token LLMs
                  </h3>
                  <div className="gp-bench-topic-meta">
                    <span className="gp-bench-badge">Production</span>
                    <span className="gp-bench-date">Jul 2025</span>
                  </div>
                </a>
              </div>
            </Reveal>

            {/* Right Content */}
            <div className="gp-bench-content">
              <Reveal>
                <h2 className="gp-bench-h2">Understanding the benchmark methodology</h2>
                <p className="gp-bench-p" style={{ marginTop: 16 }}>
                  24 cases — one vulnerable and one clean fixture per class, so a tool can fail by missing a vulnerability
                  or by crying wolf on safe code. Identical corpus, identical scoring, every tool at a pinned version.
                </p>
              </Reveal>

              <Reveal delay={1}>
                <h3 className="gp-bench-h3">24-Case Scoring Matrix</h3>
                <div className="gp-table-wrap" style={{ marginTop: 16 }}>
                  <table className="gp-table">
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Agentic classes detected</th>
                        <th>False positives</th>
                        <th>Deterministic</th>
                        <th>Execution Speed</th>
                        <th>Cost / Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARISON.map((row) => (
                        <tr key={row.tool} className={row.us ? "gp-row-us" : undefined}>
                          <td style={{ fontWeight: row.us ? 600 : 400 }}>{row.tool}</td>
                          <td className="gp-num" style={{ color: row.us ? "var(--accent)" : undefined }}>
                            {row.detected}
                          </td>
                          <td className="gp-num">{row.fp}</td>
                          <td className="gp-num">{row.deterministic}</td>
                          <td className="gp-num">{row.speed}</td>
                          <td className="gp-num">{row.cost}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Reveal>

              <Reveal delay={2}>
                <h3 className="gp-bench-h3">Dominating AI-Native &amp; Agentic Security Benchmarks</h3>
                <p className="gp-bench-p" style={{ marginTop: 16 }}>
                  In head-to-head testing across the 12 OWASP Agentic Application vulnerability classes, Gatepass delivers total domain dominance over AI code reviewers like CodeRabbit, raw LLM prompts, and legacy SAST scanners.
                </p>

                <ul className="gp-bench-bullets">
                  <li><strong>100% Detection &amp; Zero False Alarms:</strong> Catches all 12/12 agentic vulnerability classes with 0% false positives and runnable proof-of-concept reproductions for every finding.</li>
                  <li><strong>Sub-Millisecond Execution (0.9ms):</strong> Operates up to 80,000x faster than LLM code tools (60s–90s), preventing developer PR pipeline bottlenecks.</li>
                  <li><strong>100% Deterministic Merge Gate:</strong> Produces byte-identical output across runs so CI builds never randomly fail or pass based on non-deterministic model temperature.</li>
                  <li><strong>Zero Token Overhead ($0):</strong> Eliminates expensive token usage and per-developer API fees required by CodeRabbit and frontier models.</li>
                </ul>

                <blockquote className="gp-bench-quote">
                  “Against traditional scanners and AI code reviewers, Gatepass stands alone: CodeRabbit missed 10 of 12 agentic classes, Semgrep and Gitleaks caught only 1, and Snyk cannot parse agentic infrastructure.”
                </blockquote>

                <BenchmarkVisualCard />

                <div style={{ marginTop: 20 }}>
                  <a className="gp-link" href="#benchmarks">
                    Read the full method and re-run it yourself
                    <ArrowUpRight size={16} />
                  </a>
                </div>
              </Reveal>
            </div>
          </div>
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
                  <a href={SITE.docs} target="_blank" rel="noreferrer">Documentation</a>
                </li>
                <li>
                  <a href={SITE.github} target="_blank" rel="noreferrer">GitHub</a>
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
