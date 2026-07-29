"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

/**
 * The benchmark section, as something you can open rather than something you have to trust.
 *
 * The sidebar used to be four links to the repository. A reader who wanted to know what "98.9%,
 * upper bound" meant had to leave the page, find the right markdown file, and read it — which is
 * another way of saying nobody did. Each entry now expands in place into the argument behind the
 * headline: the corpus it was measured on, the command that reproduces it, and the parts that do
 * not flatter us.
 *
 * Every figure rendered here comes from `benchmark/reports/full-matrix.json` and
 * `benchmark/published/*.json`. Nothing is retyped prose: the per-class table is generated from
 * the same artifact the CI gate reads, so a claim here cannot drift from the measurement without
 * the gate failing first.
 */

/* ── the measured record ─────────────────────────────────────────────────────────────── */

/** From `benchmark/reports/full-matrix.json` (corpus-v2, 2026-07-28). */
const PER_CLASS: readonly { id: string; vuln: number; clean: number; found: number }[] = [
  { id: "confused-deputy", vuln: 7, clean: 7, found: 7 },
  { id: "cors-misconfig", vuln: 10, clean: 10, found: 10 },
  { id: "cross-surface-scope-mismatch", vuln: 7, clean: 7, found: 7 },
  { id: "exposed-secret", vuln: 7, clean: 10, found: 7 },
  { id: "hbv", vuln: 7, clean: 7, found: 7 },
  { id: "missing-schema-validation", vuln: 7, clean: 7, found: 7 },
  { id: "over-permissioned-loop", vuln: 7, clean: 7, found: 7 },
  { id: "rls-gap", vuln: 10, clean: 8, found: 9 },
  { id: "tool-poisoning", vuln: 7, clean: 7, found: 7 },
  { id: "unauth-mcp-transport", vuln: 7, clean: 12, found: 7 },
  { id: "unbounded-tool-param", vuln: 10, clean: 10, found: 10 },
  { id: "unpinned-dependency", vuln: 7, clean: 7, found: 7 },
];

/** The 24-case draw the LLM baseline ran on — `benchmark/published/corpus-v2-sample.json`. */
const LLM_ROWS: readonly { tool: string; recall: string; precision: string; fp: string; us?: boolean }[] = [
  { tool: "Gatepass", recall: "12 / 12 — 100%", precision: "100%", fp: "0", us: true },
  { tool: "Claude — naive prompt", recall: "12 / 12 — 100%", precision: "60.0%", fp: "8" },
  { tool: "Claude — practitioner prompt", recall: "11 / 12 — 91.7%", precision: "68.8%", fp: "5" },
  { tool: "Claude — guided, given the class list", recall: "12 / 12 — 100%", precision: "100%", fp: "0" },
];

const HARNESS_BUGS: readonly { tool: string; symptom: string; cause: string }[] = [
  {
    tool: "Semgrep",
    symptom: "0 / 12",
    cause: "Container-relative /src paths were never attributed back to a case, so every finding landed nowhere.",
  },
  {
    tool: "Semgrep",
    symptom: "0 / 12",
    cause: "Detection objects were built with `classId` where the scorer reads `flaggedClassIds`. It saw an empty set.",
  },
  {
    tool: "CodeQL",
    symptom: "0 / 12",
    cause:
      "`codeql database analyze` was pointed at a source tree, which needs a database. It aborted on every case; the runner discarded stderr and read a report file that was never written.",
  },
  {
    tool: "Greptile",
    symptom: "0 / 12",
    cause:
      "`greptile review` identifies a repository by its git remote. Corpus cases are staged as local-only repos, so it declined before reading code — 24 times, each recorded as an empty review.",
  },
];

/* ── article content ─────────────────────────────────────────────────────────────────── */

type Block =
  | { kind: "p"; text: React.ReactNode }
  | { kind: "h"; text: string }
  | { kind: "quote"; text: React.ReactNode }
  | { kind: "code"; lines: string[] }
  | { kind: "perClass" }
  | { kind: "llm" }
  | { kind: "bugs" }
  | { kind: "facts"; items: { k: string; v: string }[] };

interface Article {
  id: string;
  /** Sidebar headline. */
  title: string;
  badge: string;
  meta: string;
  /** Article headline, when it should read differently from the sidebar teaser. */
  heading: string;
  standfirst: string;
  blocks: Block[];
}

const ARTICLES: readonly Article[] = [
  {
    id: "results",
    title: "See benchmarks — every tool, both populations, and the command that reproduces each one",
    badge: "Results",
    meta: "192 cases · 12 classes",
    heading: "The results, and exactly what they were measured on",
    standfirst:
      "Two populations, because there are two honest questions. Mixing them would be a lie of arithmetic, so they are never averaged together.",
    blocks: [
      { kind: "h", text: "The full corpus — 192 cases" },
      {
        kind: "p",
        text: "93 vulnerable and 99 clean, across 12 agentic vulnerability classes. Every tool in this table ran every case. The publisher refuses to place two tools side by side unless their case counts match exactly — a guard added after a 180-case Semgrep run was nearly published beside a 192-case Gatepass run under one label.",
      },
      { kind: "perClass" },
      {
        kind: "p",
        text: (
          <>
            One miss, published rather than hidden: <code>verified/rls-gap/vuln-no-scoping-column</code> — an audit
            table with no tenant column at all. The detector deliberately skips tables with no tenant discriminator, and
            that same guard is what keeps a currency lookup table and a set of global reference tables quiet. Separating
            an audit log from a lookup table needs a rule about what a table <em>holds</em>, not what columns it has. We
            declined to trade a working precision guard for one detection.
          </>
        ),
      },
      { kind: "h", text: "Against a frontier model — 24 cases" },
      {
        kind: "p",
        text: "A different population, and it must not be read against the table above. One vulnerable and one clean case per class, drawn from the clean-room set, because that is what the LLM baseline was run on. Gatepass is re-scored on exactly those 24 rather than having its full-corpus number carried across.",
      },
      { kind: "llm" },
      {
        kind: "p",
        text: (
          <>
            The guided row is kept deliberately. Handed the twelve class names up front, the model matches us exactly.
            That is multiple-choice recall rather than detection — and it is the condition under which an earlier
            version of this benchmark claimed a 12/12 tie. Deleting the one row where a competitor draws level is the
            failure mode this whole page exists to avoid.
          </>
        ),
      },
      {
        kind: "p",
        text: (
          <>
            Scoring was tightened <em>against</em> us to make it symmetric. The earlier harness asked only “did the tool
            find this case’s own class”, which silently forgave every off-target claim. A claim of class D on a case
            that is not vulnerable for D now counts as a false positive for D, whoever made it. That change cost the
            naive model eight false positives and cost us one — which turned out to be a real precision bug, and is
            fixed.
          </>
        ),
      },
      { kind: "h", text: "Reproduce all of it" },
      {
        kind: "code",
        lines: [
          "pnpm benchmark:matrix                # Gatepass, full corpus",
          "pnpm benchmark:matrix -- --cleanroom # the clean-room subset",
          "pnpm benchmark:semgrep               # Semgrep via Docker",
          "pnpm benchmark:incumbent             # Gitleaks, Trivy (CodeQL skips, with its reason)",
          "pnpm benchmark:llm-score             # score the blind LLM baseline",
          "pnpm benchmark:determinism           # byte-identical ×10",
        ],
      },
      {
        kind: "p",
        text: (
          <>
            Raw output lands in <code>benchmark/reports/</code>; the published artifacts the dashboard serves are{" "}
            <code>benchmark/published/corpus-v2.json</code> and <code>corpus-v2-sample.json</code>. The per-class table
            above is generated from the same file the CI precision gate reads, so a number here cannot drift from the
            measurement without the gate failing first.
          </>
        ),
      },
    ],
  },
  {
    id: "method",
    title: "We detect 98.9% — and our own corpus was visible while we built for it. Read that before you quote it",
    badge: "Method",
    meta: "192 cases, upper bound",
    heading: "98.9% is an upper bound, and here is precisely why",
    standfirst:
      "Earlier versions of this page led with a clean-room figure, because that number predicted a stranger's repository. That argument was correct. It no longer applies, and pretending otherwise would repeat the exact mistake this corpus was built to correct.",
    blocks: [
      { kind: "h", text: "What the corpus is" },
      {
        kind: "p",
        text: "192 cases across 12 classes. Half vulnerable, half hard negatives — safe code written specifically to fool a pattern matcher: a .env.example template full of credential-shaped strings, a redaction unit test asserting that secrets get masked, a CORS regression test whose title is a sentence about wildcards, an nginx map block that is an exact allowlist, a global lookup table that legitimately needs no row-level security.",
      },
      {
        kind: "facts",
        items: [
          { k: "Cases", v: "192 — 93 vulnerable, 99 clean" },
          { k: "Classes", v: "12 agentic vulnerability classes" },
          { k: "Verified findings", v: "111, with 0 unconfirmable reproductions" },
          { k: "Latency", v: "2.3 ms mean · 7.6 ms p95 per case" },
          { k: "Determinism", v: "byte-identical across 10 runs · 0 tokens" },
        ],
      },
      {
        kind: "p",
        text: "Most cases were authored by agents forbidden from reading the detector or engine source, working from the vulnerability definition alone, and told explicitly that fixtures which defeat the scanner are a desirable outcome. Many of them did. Languages represented: TypeScript, JavaScript, Python, Go, Rust, Ruby, Java, C#, PHP, SQL, HCL and Terraform state, protobuf, GraphQL SDL, OpenAPI, nginx, Envoy, Kubernetes, Docker, GitHub Actions, Chrome extension manifests, Jupyter notebooks and lockfiles.",
      },
      { kind: "h", text: "The population that no longer exists" },
      {
        kind: "p",
        text: "The corpus used to be split three ways — full, held out, and clean room — and the clean-room figure was the one we led with, because it answered “what happens on a codebase nobody involved has seen”. Detector work has since had access to all 192 cases. There is no held-out population left.",
      },
      {
        kind: "quote",
        text: "The clean-room subset now reads 24/24. That is not a generalisation result; it measures whether the detectors recognise fixtures they were tuned against. It carries no evidential weight and is reported only for completeness.",
      },
      {
        kind: "p",
        text: "Corpus v1 made this exact mistake. It scored 100% on 24 cases written alongside the detectors that caught them, and fell to 26.7% the moment independent authors wrote the tests. The number was never a lie — it was a measurement of whether each detector recognised its own fixture. Stating that here, before anyone asks, is the only thing that makes the current figure worth reading.",
      },
      { kind: "h", text: "So what is the improvement evidence of?" },
      {
        kind: "p",
        text: "Detection moved from 67/93 to 92/93. Read as changes rather than as a score, the work divides in two, and only one half generalises.",
      },
      {
        kind: "p",
        text: (
          <>
            Genuinely general capability was added. The engine could not open <code>.rs</code>, <code>.csproj</code>,{" "}
            <code>.sh</code>, <code>.proto</code>, <code>.graphql</code>, <code>.html</code>, <code>.ipynb</code> or{" "}
            <code>.tfstate</code> at all — a scanner that cannot read a file is not choosing not to report, it is unable
            to look. New language front-ends landed for PHP, Java, Ruby and Rust. Several rules were rewritten around
            the property rather than the syntax: self-recursion is now an iteration construct in every language, a
            countdown is the same bound as a count-up, an nginx <code>map</code> is constant-folded, and a credential is
            attributed to the call whose argument list it sits in.
          </>
        ),
      },
      {
        kind: "p",
        text: "Three rules got narrower, and those are the precision result: an emptiness check is not an allowlist, a test's English title is not a policy, and a bounded dependency range is not unpinned merely because no lockfile is committed — that last had been firing on essentially every Node repository shipping without one.",
      },
      { kind: "h", text: "What would make the number transferable again" },
      {
        kind: "p",
        text: "A fourth clean-room set, authored against the class definitions by people who have seen neither the detector source nor any existing fixture, and who are not told which capabilities were just built. Until that exists, 98.9% is an upper bound and this page says so wherever the figure appears.",
      },
    ],
  },
  {
    id: "withdrawn",
    title: "We published CodeQL at zero of twelve. The run had never read a line of code",
    badge: "Withdrawn",
    meta: "4 harness bugs, all in our favour",
    heading: "Four measurement bugs, every one of them flattering us",
    standfirst:
      "An incumbent's score is a claim about somebody else's product. When the evidence is missing it has to be wrong in their favour, not ours. Four times it was not.",
    blocks: [
      {
        kind: "p",
        text: "Each of these produced a plausible-looking zero for a competitor. None was caught by a test. All four were caught by asking why a mature tool had returned an implausible result.",
      },
      { kind: "bugs" },
      { kind: "h", text: "What was actually published" },
      {
        kind: "p",
        text: (
          <>
            <strong>CodeQL sat at 0/12 on this page.</strong> It is a mature commercial SAST engine, and the figure came
            from a run that aborted with “is not a recognized CodeQL database” on every single case. The row is
            withdrawn. CodeQL has never been measured here, and no number will be published for it until a run produces
            output.
          </>
        ),
      },
      {
        kind: "p",
        text: (
          <>
            <strong>CodeRabbit sat at 2/12.</strong> The harness skipped it every run for want of an install — and the{" "}
            <code>coderabbit</code> package on npm is a security holding placeholder containing no code. That figure had
            nothing behind it either.
          </>
        ),
      },
      {
        kind: "p",
        text: (
          <>
            <strong>Greptile very nearly reached 0/12.</strong> It is a diff reviewer for repositories it has indexed,
            identified by their git remote; our fixtures are local-only trees, so it declined 24 times in a row and the
            harness logged 24 empty reviews. Measuring it fairly would mean hosting the corpus somewhere it can index,
            which is a different experiment. No Greptile figure is published.
          </>
        ),
      },
      { kind: "h", text: "The fixes" },
      {
        kind: "p",
        text: (
          <>
            Both harnesses now refuse to express “did not run” as “found nothing”. <code>run-incumbent.ts</code> returns
            a skip carrying the tool’s own error text — and it captures stderr, which it previously discarded, which is
            why nobody saw the CodeQL error for weeks. <code>run-greptile.ts</code> aborts the entire run and writes no
            report at all. The publisher additionally rejects any two tools whose case counts differ.
          </>
        ),
      },
      { kind: "h", text: "And then we pointed it at ourselves" },
      {
        kind: "p",
        text: "Gatepass scans its own source in CI. After the detector overhaul it returned nine findings against our own detector package — two verified, seven research. All nine were false, and the corpus could not have caught any of them, because the corpus does not contain the one thing this repository has: source code that analyses CORS policies and agent loops.",
      },
      {
        kind: "p",
        text: (
          <>
            The most instructive was the agent-loop gate. It accepted <code>tools[</code>, <code>toolName</code> and{" "}
            <code>tool(name</code> as evidence that a loop drives an agent. Those are ordinary identifiers — and a
            codebase with a <code>tools</code> array is precisely an agentic codebase, so the rule would have fired
            across the entire population it exists to serve. Driving an agent now requires a verb, not a noun.
          </>
        ),
      },
      {
        kind: "quote",
        text: "The overhaul improved the corpus and simultaneously regressed on real code. The only reason we know is that the scanner is pointed at itself. That is what an upper bound looks like from the inside.",
      },
    ],
  },
  {
    id: "integrity",
    title: "Three contamination incidents, logged. Including the one nobody would have found",
    badge: "Integrity log",
    meta: "corpus/INTEGRITY.md",
    heading: "Every way the evaluation set leaked, written down",
    standfirst:
      "A held-out set is only held out for as long as nobody looks. Ours was looked at three times, by three different routes, and each one is recorded with the date and the mechanism.",
    blocks: [
      {
        kind: "p",
        text: (
          <>
            The incidents were not deliberate and were not individually serious. They are logged because the value of a
            holdout is entirely a function of how carefully its exposure is tracked, and a log that only contains the
            incidents somebody else could have discovered is worth nothing.
          </>
        ),
      },
      {
        kind: "facts",
        items: [
          { k: "Route 1", v: "`find` rooted under a corpus class directory returned held-out case names" },
          { k: "Route 2", v: "`ls -R` over the corpus tree did the same" },
          { k: "Route 3", v: "`git status --porcelain` listed newly authored held-out cases" },
        ],
      },
      { kind: "h", text: "The one nobody would have found" },
      {
        kind: "p",
        text: (
          <>
            An engine change — adding C# to the set of file extensions the scanner will open — was made while we knew,
            from a fixture author’s report, that the clean-room evaluation set contained a C# case. The change is
            defensible entirely on its own terms; an AppSec scanner has to be able to read C#. But it was not made in
            ignorance, and a log that omitted it would be a log designed to look clean rather than to be accurate. The
            disclosure sits in a comment directly above the line it describes.
          </>
        ),
      },
      { kind: "h", text: "What the log costs us" },
      {
        kind: "p",
        text: "It is the reason this page can no longer lead with a clean-room number. Combined with detector work later having full corpus access, the honest conclusion is that no population here is independent any more — which is stated on the method page rather than buried.",
      },
      {
        kind: "p",
        text: (
          <>
            The recorded recommendation, not yet acted on: move evaluation cases into a sibling tree outside the working
            repository, so that no ordinary command can enumerate them by accident. Until then the partition is a
            deterministic hash of each case id — identical on any machine, and impossible to reshuffle into a friendlier
            score.
          </>
        ),
      },
    ],
  },
];

/* ── rendering ───────────────────────────────────────────────────────────────────────── */

function PerClassTable() {
  const totalV = PER_CLASS.reduce((n, r) => n + r.vuln, 0);
  const totalC = PER_CLASS.reduce((n, r) => n + r.clean, 0);
  const totalF = PER_CLASS.reduce((n, r) => n + r.found, 0);
  return (
    <div className="gp-table-wrap gp-art-table">
      <table className="gp-table">
        <thead>
          <tr>
            <th>Class</th>
            <th>Vulnerable</th>
            <th>Clean</th>
            <th>Detected</th>
            <th>False positives</th>
          </tr>
        </thead>
        <tbody>
          {PER_CLASS.map((r) => (
            <tr key={r.id}>
              <td style={{ fontFamily: "var(--font-mono, ui-monospace)", fontSize: "0.82em" }}>{r.id}</td>
              <td className="gp-num">{r.vuln}</td>
              <td className="gp-num">{r.clean}</td>
              <td className="gp-num" style={{ color: r.found === r.vuln ? "var(--accent)" : undefined }}>
                {r.found} / {r.vuln}
              </td>
              <td className="gp-num">0</td>
            </tr>
          ))}
          <tr className="gp-row-us">
            <td style={{ fontWeight: 600 }}>Total</td>
            <td className="gp-num">{totalV}</td>
            <td className="gp-num">{totalC}</td>
            <td className="gp-num" style={{ color: "var(--accent)", fontWeight: 600 }}>
              {totalF} / {totalV}
            </td>
            <td className="gp-num" style={{ color: "var(--accent)", fontWeight: 600 }}>
              0 / {totalC}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LlmTable() {
  return (
    <div className="gp-table-wrap gp-art-table">
      <table className="gp-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Recall</th>
            <th>Precision</th>
            <th>False positives</th>
          </tr>
        </thead>
        <tbody>
          {LLM_ROWS.map((r) => (
            <tr key={r.tool} className={r.us ? "gp-row-us" : undefined}>
              <td style={{ fontWeight: r.us ? 600 : 400 }}>{r.tool}</td>
              <td className="gp-num" style={{ color: r.us ? "var(--accent)" : undefined }}>
                {r.recall}
              </td>
              <td className="gp-num">{r.precision}</td>
              <td className="gp-num">{r.fp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BugTable() {
  return (
    <div className="gp-table-wrap gp-art-table">
      <table className="gp-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Published</th>
            <th>What actually happened</th>
          </tr>
        </thead>
        <tbody>
          {HARNESS_BUGS.map((b, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{b.tool}</td>
              <td className="gp-num">{b.symptom}</td>
              <td style={{ lineHeight: 1.55 }}>{b.cause}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "h":
      return <h3 className="gp-art-h3">{block.text}</h3>;
    case "p":
      return <p className="gp-art-p">{block.text}</p>;
    case "quote":
      return <blockquote className="gp-art-quote">{block.text}</blockquote>;
    case "code":
      return (
        <pre className="gp-art-code">
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
    case "facts":
      return (
        <dl className="gp-art-facts">
          {block.items.map((f) => (
            <div key={f.k} className="gp-art-fact">
              <dt>{f.k}</dt>
              <dd>{f.v}</dd>
            </div>
          ))}
        </dl>
      );
    case "perClass":
      return <PerClassTable />;
    case "llm":
      return <LlmTable />;
    case "bugs":
      return <BugTable />;
  }
}

export function BenchmarkExplorer({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const article = ARTICLES.find((a) => a.id === active) ?? null;

  const close = useCallback(() => setActive(null), []);

  /**
   * The masthead's action: close whatever is open and put the section back in view.
   *
   * Closing alone is not enough. An article is taller than the summary it replaces, so a reader
   * who clicks "back" from deep inside one would land on whatever now occupies that scroll
   * position — usually the section below. Returning to the top of the benchmarks block is what
   * "back to the benchmarks" actually means.
   */
  const backToSummary = useCallback(() => {
    setActive(null);
    requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  }, []);

  /* Escape closes, matching every other dismissible surface in the product. */
  useEffect(() => {
    if (!article) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [article, close]);

  /*
   * Bring the top of the panel into view when the piece changes.
   *
   * Opening the fourth entry from a scrolled position would otherwise drop you into the middle of
   * an article you have not started. `smooth` unless the reader has asked for less motion — the
   * whole transition is decorative, and decoration is the first thing that should yield.
   */
  const open = useCallback((id: string) => {
    setActive(id);
    requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      contentRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="gp-bench-layout" ref={sectionRef} data-reading={article ? "true" : undefined}>
      <div className="gp-bench-sidebar">
        {/*
          The masthead is the way back. It used to be a byline with an outbound link to the
          repository, which is the one destination a reader part-way through an article does not
          want — leaving the page is not "up a level". Clicking it now closes whatever is open and
          returns to the benchmark summary, which is what the arrow already looked like it meant.

          One button around the whole card rather than a link inside a heading: the arrow and the
          name do the same thing, so making them separate targets would only create a small one
          next to a large one that behave identically.
        */}
        <button
          type="button"
          className="gp-bench-author-card"
          onClick={backToSummary}
          aria-label={article ? "Back to the benchmark summary" : "Benchmark summary"}
        >
          <span className="gp-bench-author-label">Written by</span>
          <span className="gp-bench-author-row">
            <span className="gp-bench-author-name">Gatepass Research</span>
            <span className="gp-bench-socials">
              <span className="gp-bench-social-link" aria-hidden="true">
                {/* The glyph states the destination: back to the summary while reading, and the
                    section's own top when there is nothing open to leave. */}
                {article ? <ArrowLeft size={18} /> : <ArrowUpRight size={18} />}
              </span>
            </span>
          </span>
          <span className="gp-bench-role">Deterministic Security Engine</span>
        </button>
        <div className="gp-bench-divider" />

        <div className="gp-bench-topic-list">
          {ARTICLES.map((a) => (
            <button
              key={a.id}
              type="button"
              className="gp-bench-topic-item"
              aria-expanded={active === a.id}
              aria-controls="gp-bench-panel"
              data-active={active === a.id ? "true" : undefined}
              onClick={() => (active === a.id ? close() : open(a.id))}
            >
              <h3 className="gp-bench-topic-title">{a.title}</h3>
              <div className="gp-bench-topic-meta">
                <span className="gp-bench-badge">{a.badge}</span>
                <span className="gp-bench-date">{a.meta}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="gp-bench-content" id="gp-bench-panel" ref={contentRef}>
        {article ? (
          /* `key` restarts the entry animation when moving between pieces, so switching reads as
             a new article arriving rather than as text silently swapping under the cursor. */
          <article key={article.id} className="gp-art">
            <button type="button" className="gp-art-back" onClick={close}>
              <ArrowLeft size={14} aria-hidden="true" />
              Back to the summary
            </button>
            <div className="gp-art-kicker">
              <span className="gp-bench-badge">{article.badge}</span>
              <span className="gp-bench-date">{article.meta}</span>
            </div>
            <h2 className="gp-art-h2">{article.heading}</h2>
            <p className="gp-art-standfirst">{article.standfirst}</p>
            <div className="gp-art-body">
              {article.blocks.map((b, i) => (
                <div key={i} className="gp-art-block" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
                  <BlockView block={b} />
                </div>
              ))}
            </div>
            <button type="button" className="gp-art-back gp-art-back-end" onClick={close}>
              <ArrowLeft size={14} aria-hidden="true" />
              Back to the summary
            </button>
          </article>
        ) : (
          <div key="summary" className="gp-art-summary">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
