import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Boxes,
  FlaskConical,
  GitPullRequest,
  ShieldCheck,
  Target,
} from "lucide-react";
import { serverApi, requireSession } from "@/lib/session";
import type { BenchmarkData, Finding, ScanSummary } from "@/lib/types";
import { Badge, Card, CardTitle, CodeBlock, Stat } from "@/components/ui";

/**
 * What Gatepass can show somebody evaluating it in ten minutes.
 *
 * ## Why this page exists at all
 *
 * Every other surface in this product answers "what is wrong with my code". An evaluator is
 * asking a different question — *does this thing work, and is it different from what already
 * exists* — and answering it by handing them the Findings table means asking them to take the
 * findings on faith. That is exactly the wrong ask for a security tool, because "we found
 * things" is what every scanner says and noise is the reason people turn them off.
 *
 * ## The rule this page is built on
 *
 * **Every number here is read from this deployment at request time.** Nothing is written by
 * hand, nothing is a marketing figure, and where the data is missing the page says the data is
 * missing rather than rendering a zero or a placeholder. The constitution's first principle is
 * that precision is measured and published; a page that overstated it to impress an investor
 * would violate the thing it is trying to demonstrate.
 *
 * That constraint also chose the order. The lead is the one claim that is externally checkable
 * — a scored comparison against named, versioned incumbent tools on a tagged corpus — and not
 * the one that flatters most.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Proof — Gatepass",
  robots: { index: false, follow: false },
};

/** A tool's row in a published benchmark run. */
interface ToolRun {
  tool: string;
  perClass: { classId: string; tp: number; fp: number; fn: number }[];
}

/** Classes where the tool produced at least one true positive — "did it see this at all". */
function detected(run: ToolRun): number {
  return run.perClass.filter((c) => c.tp > 0).length;
}

function totals(run: ToolRun) {
  const tp = run.perClass.reduce((n, c) => n + c.tp, 0);
  const fp = run.perClass.reduce((n, c) => n + c.fp, 0);
  const fn = run.perClass.reduce((n, c) => n + c.fn, 0);
  return {
    tp,
    fp,
    fn,
    // Null rather than 0 when a tool flagged nothing: "no data" and "wrong every time" are
    // different, and scoring the first as the second would flatter us with a fabrication.
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
  };
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** `owner/repo` — a real GitHub repository, as opposed to a directory on the API host. */
const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

/**
 * A link to the exact line this finding is about, on github.com, at the commit that was scanned.
 *
 * This is the difference between a claim and a checkable one. Pinned to the SHA rather than the
 * branch on purpose: a link to `main` shows whatever the file says today, which quietly stops
 * matching the finding the moment anyone pushes — and then reads as a false positive.
 */
function blobUrl(repo: string | undefined, sha: string | undefined, path: string, line?: number): string | null {
  if (!repo || !sha || !REPO_SLUG.test(repo)) return null;
  return `https://github.com/${repo}/blob/${sha}/${path}${line ? `#L${line}` : ""}`;
}

export default async function ProofPage() {
  const session = await requireSession("/proof");
  const api = await serverApi();

  // Every fetch degrades to "we could not read this" rather than failing the page: a partial
  // page that says which part is missing is more useful to an evaluator than an error screen.
  const benchmark = await api
    .getBenchmark()
    .then((r) => (Array.isArray(r) ? r : [r]) as BenchmarkData[])
    .catch(() => null);
  const scans = await api.listScans(session.orgId).catch(() => null);

  /*
   * The scan the worked example comes from: the one with the most findings, not the most recent.
   *
   * With several seeded repositories the newest is as likely as not to be a clean one, and a
   * section titled "verified means reproducible" that opens on a scan with nothing to reproduce
   * demonstrates the opposite of its claim. The clean results are not being hidden — they are
   * the subject of the table directly above this.
   */
  const withFindings = [...(scans ?? [])].sort((a, b) => b.verified + b.research - (a.verified + a.research));
  const latest = withFindings[0];
  const findings = latest ? await api.getFindings(latest.id).catch(() => null) : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[1.5rem] leading-tight font-medium tracking-[-0.02em] text-fg">Proof</h1>
        <p className="mt-2 max-w-3xl text-[0.9rem] leading-relaxed text-fg-secondary">
          Every figure below is read from this deployment when the page loads — the benchmark from the published
          artifact, the findings from a scan that actually ran. Where something has not been measured, this page says so
          rather than showing a zero.
        </p>
      </header>

      <TheGap benchmark={benchmark} />
      <OnRealCode scans={scans} />
      <VerifiedMeansReproducible findings={findings} scan={latest} />
      <FromFindingToFix findings={findings} />
      <WhatItWillNotDo />
    </div>
  );
}

/**
 * The lead: what existing scanners find on the same corpus.
 *
 * This is the whole argument. Not "we are accurate" — accuracy on your own test set is a claim
 * every tool can make — but "these classes are invisible to the tools you already run, and here
 * is the scored run that shows it, against named versions on a tagged corpus you can execute
 * yourself".
 */
function TheGap({ benchmark }: { benchmark: BenchmarkData[] | null }) {
  const current = benchmark?.[0];
  const runs = (current?.runs ?? []) as ToolRun[];
  const gatepass = runs.find((r) => r.tool.toLowerCase().startsWith("gatepass"));
  const others = runs.filter((r) => r !== gatepass);
  const classes = gatepass?.perClass.length ?? 0;
  const bestIncumbent = others.length > 0 ? Math.max(...others.map(detected)) : null;
  // Recorded on each run at publish time; absent on an artifact that predates it.
  const cases = (gatepass as unknown as { casesMeasured?: number }).casesMeasured;

  if (!current || !gatepass) {
    return (
      <Card header={<CardTitle icon={<Target size={15} />}>The gap</CardTitle>}>
        <p className="text-[0.84rem] leading-relaxed text-fg-secondary">
          No benchmark has been published to this deployment, so there is nothing measured to show. An empty benchmark
          is not a score of zero for any tool — it means no run has been recorded here. Publish one with{" "}
          <code className="font-mono text-fg-muted">pnpm corpus:publish</code>.
        </p>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <p className="text-[0.72rem] font-medium tracking-[0.06em] text-fg-muted uppercase">The gap</p>
        <p className="mt-3 max-w-3xl text-[1.35rem] leading-snug font-medium tracking-[-0.02em] text-fg">
          On the same corpus, the scanners teams already run detect{" "}
          <span className="text-critical">
            {bestIncumbent ?? 0} of {classes}
          </span>{" "}
          AI-native vulnerability classes. Gatepass detects{" "}
          <span className="text-verified">
            {detected(gatepass)} of {classes}
          </span>
          .
        </p>
        <p className="mt-3 max-w-3xl text-[0.82rem] leading-relaxed text-fg-secondary">
          The classes are things like MCP tool-definition poisoning, cross-surface scope mismatch and confused-deputy
          flows. Existing scanners do not miss them because they are bad — they miss them because they do not model
          agentic infrastructure at all.
        </p>
      </div>

      <Card
        header={
          <CardTitle icon={<Target size={15} />}>
            Scored run — {current.corpusVersion}
            <Link
              href="/benchmark"
              className="ml-3 inline-flex items-center gap-1 text-[0.75rem] font-normal text-fg-muted hover:text-fg"
            >
              full per-class breakdown <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </CardTitle>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[0.82rem]">
            <thead>
              <tr className="border-b border-line text-left text-[0.72rem] tracking-[0.04em] text-fg-muted uppercase">
                <th className="pb-2 font-medium">Tool</th>
                <th className="pb-2 text-right font-medium">Classes detected</th>
                <th className="pb-2 text-right font-medium">Precision</th>
                <th className="pb-2 text-right font-medium">Recall</th>
              </tr>
            </thead>
            <tbody>
              {[gatepass, ...others].map((run) => {
                const t = totals(run);
                const isUs = run === gatepass;
                return (
                  <tr key={run.tool} className="border-b border-line/60 last:border-0">
                    <td className={`py-2.5 ${isUs ? "font-medium text-fg" : "text-fg-secondary"}`}>{run.tool}</td>
                    <td data-numeric className="py-2.5 text-right text-fg">
                      {detected(run)} / {run.perClass.length}
                    </td>
                    <td data-numeric className="py-2.5 text-right text-fg">
                      {pct(t.precision)}
                    </td>
                    <td data-numeric className="py-2.5 text-right text-fg">
                      {pct(t.recall)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/*
          The caveat is on the page, not in a footnote somebody has to ask for. A perfect score
          on a corpus you wrote yourself is worth exactly as much as the corpus, and an evaluator
          who has to discover that for themselves will discount everything else here too.
        */}
        <p className="mt-4 border-t border-line pt-4 text-[0.78rem] leading-relaxed text-fg-muted">
          <strong className="font-medium text-fg-secondary">Read this honestly:</strong> {current.corpusVersion} is{" "}
          {typeof cases === "number" ? `${cases} cases` : "a small corpus"} across {classes} classes, and Gatepass
          authored it — a tool scoring well on its own test set is the beginning of an argument, not the end of one.
          What is checkable is the other three rows: the corpus is tagged and immutable, the incumbent versions and rule
          packs are named, the harness is in <code className="font-mono">corpus/harness</code>, and anyone can run it
          and get these numbers back.
        </p>
      </Card>
    </section>
  );
}

/**
 * The other half of the argument: what Gatepass says about code nobody here wrote.
 *
 * The benchmark above can only ever measure one direction. Its corpus is built from planted
 * vulnerabilities, so it answers "does Gatepass find what is there" and is silent on the
 * question an evaluator actually arrives with — *how much noise does this make on my repo*.
 * These are ordinary public repositories, fetched at boot and scanned with the same engine, and
 * the rows that report nothing are the point of the table rather than filler in it.
 *
 * Rendered only for repositories that came from GitHub. A local-path scan has no commit to pin
 * and no URL to check, so including one would put an unverifiable row in a table whose entire
 * purpose is that every row can be verified.
 */
function OnRealCode({ scans }: { scans: ScanSummary[] | null }) {
  const real = (scans ?? []).filter((s) => s.repo && REPO_SLUG.test(s.repo) && s.commitSha);
  if (real.length === 0) return null;

  const clean = real.filter((s) => s.verified + s.research === 0).length;

  return (
    <Card header={<CardTitle icon={<Boxes size={15} />}>Run against real public repositories</CardTitle>}>
      <p className="max-w-3xl text-[0.84rem] leading-relaxed text-fg-secondary">
        Scanned by this deployment, at the commits below, with the engine that produced the benchmark. Nothing was
        modified and nothing was planted — these are repositories this project does not control.{" "}
        {clean > 0 && (
          <>
            <strong className="font-medium text-fg">
              {clean} of {real.length} came back with nothing to report.
            </strong>{" "}
            That is the half the benchmark cannot show: a corpus of planted vulnerabilities measures whether a scanner
            finds what is there, never what it invents on code that is fine.
          </>
        )}
      </p>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-[0.82rem]">
          <thead>
            <tr className="border-b border-line text-left text-[0.72rem] tracking-[0.04em] text-fg-muted uppercase">
              <th className="pb-2 font-medium">Repository</th>
              <th className="pb-2 font-medium">Commit</th>
              <th className="pb-2 text-right font-medium">Verified</th>
              <th className="pb-2 text-right font-medium">Research</th>
            </tr>
          </thead>
          <tbody>
            {real.map((s) => {
              const quiet = s.verified + s.research === 0;
              return (
                <tr key={s.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5">
                    <a
                      href={`https://github.com/${s.repo}/tree/${s.commitSha}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-fg hover:text-accent"
                    >
                      {s.repo} <ArrowUpRight size={11} aria-hidden="true" />
                    </a>
                  </td>
                  <td data-numeric className="py-2.5 font-mono text-[0.75rem] text-fg-muted">
                    {s.commitSha!.slice(0, 7)}
                  </td>
                  <td data-numeric className="py-2.5 text-right">
                    {quiet ? <span className="text-fg-muted">—</span> : <span className="text-fg">{s.verified}</span>}
                  </td>
                  <td data-numeric className="py-2.5 text-right">
                    {quiet ? <span className="text-fg-muted">—</span> : <span className="text-fg">{s.research}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        The qualification a reader would otherwise have to discover by clicking through. The MCP
        transport findings are real and they are in example directories, which is a weaker claim
        than "in production code" and a stronger one than it first sounds — sample servers in a
        widely-copied SDK are the source of a lot of production code. Saying both halves is what
        keeps the rest of the page worth reading.
      */}
      <p className="mt-4 border-t border-line pt-4 text-[0.78rem] leading-relaxed text-fg-muted">
        <strong className="font-medium text-fg-secondary">Read this honestly:</strong> the MCP transport findings sit in
        the SDKs&apos; <code className="font-mono">examples/</code> directories, not in shipped server code — these are
        well-run projects and their production paths configure authentication. They are here because example servers in
        a widely-copied SDK are what gets pasted into production, and because no conventional scanner reports them at
        all: to <code className="font-mono">semgrep</code> an Express app on a port is an Express app on a port.
      </p>
    </Card>
  );
}

/** The surfaces that are the reason this product exists, rather than ordinary application code. */
const AI_NATIVE: ReadonlySet<string> = new Set(["mcp_server", "tool_defs", "agent_code", "permission_scopes"]);

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Which single finding to show as the worked example.
 *
 * Not the first one. This page's argument is that Gatepass sees agentic infrastructure other
 * scanners do not model at all, and the first finding in a scan is as likely as not to be an
 * unpinned dependency — true, reproducible, and an answer to a question nobody was asking here.
 * So an AI-native surface outranks severity, and severity breaks the tie. Ordering is total and
 * derived only from the finding, so the same scan always shows the same example.
 */
function pickExample(verified: Finding[]): Finding | undefined {
  return verified
    .filter((f) => f.reproduction)
    .slice()
    .sort((a, b) => {
      const aiA = a.surfaces.some((s) => AI_NATIVE.has(s)) ? 0 : 1;
      const aiB = b.surfaces.some((s) => AI_NATIVE.has(s)) ? 0 : 1;
      if (aiA !== aiB) return aiA - aiB;
      const sev = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      return sev !== 0 ? sev : a.fingerprint.localeCompare(b.fingerprint);
    })[0];
}

/**
 * The anti-noise argument, shown rather than asserted.
 *
 * Every security tool claims low false positives. What is different here is structural: the
 * findings schema is a discriminated union in which `verified` *requires* a reproduction, so a
 * verified finding with nothing to run is not a bug — it is a document the parser rejects.
 */
function VerifiedMeansReproducible({ findings, scan }: { findings: Finding[] | null; scan?: ScanSummary }) {
  const verified = findings?.filter((f) => f.tier === "verified") ?? [];
  const research = findings?.filter((f) => f.tier === "research") ?? [];
  const example = pickExample(verified);

  return (
    <section className="space-y-4">
      <Card header={<CardTitle icon={<ShieldCheck size={15} />}>Verified means reproducible</CardTitle>}>
        <p className="max-w-3xl text-[0.84rem] leading-relaxed text-fg-secondary">
          Findings come in two tiers and the boundary is enforced by the schema, not by a review policy. A{" "}
          <Badge tone="verified">verified</Badge> finding <em>must</em> carry a reproduction and <em>must not</em> carry
          a confidence score; a <Badge tone="research">research</Badge> finding is the exact opposite. A document that
          breaks either rule fails validation at the API boundary, so a verified finding with nothing to run cannot be
          stored, shipped in a PR comment, or exported as evidence.
        </p>

        {findings === null ? (
          <p className="mt-4 text-[0.82rem] text-fg-muted">
            No scan has run on this deployment yet, so there is no finding to show here.
          </p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Verified" value={verified.length} tone="verified" caption="each carries a reproduction" />
            <Stat label="Research" value={research.length} tone="research" caption="each carries a confidence score" />
            <Stat
              label="Ungrounded"
              value={0}
              tone="neutral"
              caption="structurally impossible — the schema refuses it"
            />
          </div>
        )}

        <Provenance scan={scan} />

        {example?.reproduction && (
          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[0.78rem] text-fg-muted">
              A real verified finding from{" "}
              {scan?.repo ? <span className="font-mono text-fg-secondary">{scan.repo}</span> : "the latest scan"}, with
              the reproduction it is required to carry:
            </p>
            <p className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[0.82rem] text-fg">
              {example.classId}
              {/*
                The surface is the differentiator made visible. `app_code` is a finding any
                scanner could reach; `mcp_server` is one that requires modelling agentic
                infrastructure, and the badge is the difference between asserting that and
                showing it.
              */}
              {example.surfaces
                .filter((s) => AI_NATIVE.has(s))
                .map((s) => (
                  <Badge key={s} tone="accent">
                    {s}
                  </Badge>
                ))}
            </p>
            {example.locations?.[0] &&
              (() => {
                const loc = example.locations[0]!;
                const href = blobUrl(scan?.repo, scan?.commitSha, loc.path, loc.startLine);
                const label = `${loc.path}:${loc.startLine}`;
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 font-mono text-[0.75rem] text-fg-muted underline decoration-line underline-offset-2 hover:text-fg"
                  >
                    {label} <ArrowUpRight size={11} aria-hidden="true" />
                  </a>
                ) : (
                  <p className="mt-1 font-mono text-[0.75rem] text-fg-muted">{label}</p>
                );
              })()}
            <CodeBlock
              title={`reproduction (${example.reproduction.kind})`}
              content={[
                ...example.reproduction.steps.map((s, i) => `${i + 1}. ${s}`),
                "",
                `expected: ${example.reproduction.expected}`,
              ].join("\n")}
            />
          </div>
        )}
      </Card>
    </section>
  );
}

/**
 * Where these numbers came from — repository, commit, and whether it was fetched or read locally.
 *
 * An evaluator's first reasonable suspicion about a security demo is that it is a fixture the
 * vendor wrote, and the second is that the "scan" is a stored result rather than something that
 * ran. Naming a public repository at a pinned commit answers both, and states the weaker case
 * plainly when the scan came off the local disk instead of the network.
 */
function Provenance({ scan }: { scan?: ScanSummary }) {
  if (!scan?.repo) return null;
  const remote = REPO_SLUG.test(scan.repo);
  const short = scan.commitSha?.slice(0, 7);

  return (
    <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 border-t border-line pt-4 text-[0.76rem] leading-relaxed text-fg-muted">
      {remote ? (
        <>
          <span>Fetched over the network from</span>
          <a
            href={`https://github.com/${scan.repo}${short ? `/tree/${scan.commitSha}` : ""}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-fg-secondary underline decoration-line underline-offset-2 hover:text-fg"
          >
            github.com/{scan.repo}
            {short ? `@${short}` : ""}
          </a>
          <span>
            — code this project did not write, at a commit that cannot move. The workspace was deleted when the scan
            finished; the findings below carry no source.
          </span>
        </>
      ) : (
        <span>
          Scanned from <span className="font-mono text-fg-secondary">{scan.repo}</span> on the API host — a fixture this
          project authored, not third-party code. Point <code className="font-mono">GATEPASS_DEMO_REPO</code> at a
          public repository, or use <em>Scan a repo</em>, for a result you can check against GitHub.
        </span>
      )}
    </p>
  );
}

/** The workflow wedge: the fix travels on the finding, so remediation is one click in a PR. */
function FromFindingToFix({ findings }: { findings: Finding[] | null }) {
  const withFix = findings?.filter((f) => f.suggestedFix) ?? [];
  const diffs = withFix.filter((f) => f.suggestedFix?.kind === "diff");

  return (
    <Card header={<CardTitle icon={<GitPullRequest size={15} />}>From finding to merged fix</CardTitle>}>
      <p className="max-w-3xl text-[0.84rem] leading-relaxed text-fg-secondary">
        The fix is generated during the scan, from the source, and travels on the finding itself — so the PR comment,
        the dashboard and the agent-guidance endpoint all show the same remediation rather than three regenerations that
        can disagree. Where the fix is a concrete edit, it is delivered as a GitHub{" "}
        <code className="font-mono text-fg-muted">suggestion</code> block, which a reviewer applies with one click and
        no local checkout.
      </p>
      {findings !== null && (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Findings with guidance" value={withFix.length} tone="accent" />
          <Stat label="Applicable as a diff" value={diffs.length} tone="verified" caption="one-click in a PR review" />
          <Stat
            label="Of this scan's findings"
            value={findings.length === 0 ? "—" : `${Math.round((withFix.length / findings.length) * 100)}%`}
            tone="neutral"
          />
        </div>
      )}
    </Card>
  );
}

/**
 * The trust argument.
 *
 * For a tool that asks an engineering org for repository access, what it *cannot* do is a
 * stronger claim than what it can — and every line here is a structural absence rather than a
 * policy. There is no force-push method on the interface, so there is no force-push.
 */
function WhatItWillNotDo() {
  const refusals = [
    {
      title: "Never writes CI configuration",
      detail:
        "`.github/**` is on a blocked-path list checked immediately before every write, alongside the GitLab, CircleCI, Buildkite, Jenkins and Azure equivalents. A fix that lands there is skipped and reported, not committed.",
    },
    {
      title: "Never force-pushes, merges, or writes to a default branch",
      detail:
        "Not disabled — absent. The pull-request client interface has no method for any of the three, so no code path can reach one and none can be added without changing the interface deliberately.",
    },
    {
      title: "Never opens a pull request without a human asking",
      detail:
        "There is no webhook path to the fix-PR route. It takes an explicit dashboard action, on an org that has turned the capability on, and every write is recorded as an audit event.",
    },
    {
      title: "Fails open by default",
      detail:
        "A scan that errors produces a neutral check and an annotation, not a blocked merge. Fail-closed is a per-repository opt-in, because a security tool that stops a team shipping when it breaks gets removed.",
    },
    {
      title: "Never retains your source",
      detail:
        "The workspace is deleted immediately after a scan, and the findings schema has no field that can carry source code — including the ones a self-hosted runner uploads.",
    },
    {
      title: "Access is GitHub's answer, not a list we keep",
      detail:
        "Who may see a repository is resolved from your GitHub App installation and re-derived on a short TTL. Remove somebody on GitHub and they lose access here, with nothing to remember to revoke.",
    },
  ];

  return (
    <Card header={<CardTitle icon={<Ban size={15} />}>What it structurally cannot do</CardTitle>}>
      <p className="max-w-3xl text-[0.84rem] leading-relaxed text-fg-secondary">
        Every item below is a constraint in the code with a test that fails when it is removed — not a setting, and not
        a promise in a document.
      </p>
      <ul className="mt-5 space-y-3.5">
        {refusals.map((r) => (
          <li key={r.title} className="border-l-2 border-verified-line pl-4">
            <p className="text-[0.84rem] font-medium text-fg">{r.title}</p>
            <p className="mt-1 text-[0.78rem] leading-relaxed text-fg-secondary">{r.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-[0.76rem] leading-relaxed text-fg-muted">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          These come from the project constitution (<code className="font-mono">.specify/memory/constitution.md</code>
          ), which is versioned in the repository and amended by an explicit, recorded decision rather than by changing
          one line of code.
        </span>
      </p>
      <p className="mt-3 flex items-start gap-2 text-[0.76rem] leading-relaxed text-fg-muted">
        <FlaskConical size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Research-tier findings are shown separately and never block a merge, because a probabilistic signal that can
          stop a deploy is a probabilistic signal teams disable.
        </span>
      </p>
    </Card>
  );
}
