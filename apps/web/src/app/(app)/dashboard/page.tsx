"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  FileCheck,
  FileText,
  FlaskConical,
  FolderGit2,
  Lightbulb,
  Radar,
  Search,
  Server,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useOrgId } from "@/providers/SessionProvider";
import type { Finding, FleetView, RepoRecord, ScanSummary } from "@/lib/types";
import {
  SEVERITY_ORDER,
  confidencePercent,
  cx,
  formatDate,
  pluralize,
  relativeTime,
  repoLabel,
  severityLabel,
  sharePercent,
} from "@/lib/utils";
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorPanel,
  PageHeader,
  PageSkeleton,
  Stat,
  TONE_FILL,
  TONE_VAR,
} from "@/components/ui";

/*
 * Chart geometry. The bars are HTML boxes rather than a stretched SVG so that a
 * history of one scan renders a single clean column instead of a bar smeared
 * across the card.
 */
const BAR_AREA = 150;
const COLUMN_WIDTH = 40;
/**
 * A count of 1 against a tall maximum rounds to sub-pixel and disappears. The
 * floor keeps a real finding visible; the exact figures are still carried by the
 * column's title and by the sr-only table, so nothing is overstated.
 */
const MIN_SEGMENT = 2;

/** The overview shows a slice of the latest scan; /findings has the whole set. */
const MAX_ROWS = 6;

/**
 * Every capability Gatepass has, with a route into it.
 *
 * This grid is the answer to "where is X?". The nav rail lists the same
 * destinations, but a rail is a list of words — this carries what each surface
 * is for, and it is the one place that has to change when a capability is added.
 */
const SURFACES = [
  {
    href: "/scans",
    label: "Scans",
    icon: Radar,
    blurb: "History, SARIF export, and the merge-gate decision for any scan.",
  },
  {
    href: "/findings",
    label: "Findings",
    icon: Search,
    blurb: "Filter and triage across tiers, classes and severities. Dispute a finding.",
  },
  {
    href: "/agent-guidance",
    label: "Fix guidance",
    icon: Lightbulb,
    blurb: "Structured remediation to hand to a coding agent.",
  },
  {
    href: "/repos",
    label: "Repositories",
    icon: FolderGit2,
    blurb: "What the GitHub App can read, and when each was last scanned.",
  },
  {
    href: "/fleet",
    label: "MCP fleet",
    icon: Server,
    blurb: "Registered MCP servers, their posture, and manual rescans.",
  },
  {
    href: "/compliance",
    label: "Compliance",
    icon: FileCheck,
    blurb: "WCAG, CCPA, App Store, Play, and EU AI Act posture.",
  },
  {
    href: "/evidence",
    label: "Evidence",
    icon: ShieldCheck,
    blurb: "Control coverage, platform export, questionnaire drafting.",
  },
  { href: "/benchmark", label: "Benchmark", icon: BarChart3, blurb: "Published precision against the public corpus." },
  { href: "/system", label: "System", icon: ServerCog, blurb: "Deployment state and every route this API answers." },
] as const;

interface Overview {
  scans: ScanSummary[];
  latestFindings: Finding[];
  latestRepo?: string;
  fleet?: FleetView;
  repos: RepoRecord[];
}

type Status = "loading" | "ready" | "unreachable";

function scanTotal(scan: ScanSummary): number {
  return SEVERITY_ORDER.reduce((n, severity) => n + (scan.bySeverity[severity] ?? 0), 0);
}

/** Hover text for a bar — the exact breakdown the bar only approximates. */
function describeScan(scan: ScanSummary, index: number): string {
  const total = scanTotal(scan);
  const when = scan.createdAt ? formatDate(scan.createdAt) : `Scan ${index + 1}`;
  const parts = SEVERITY_ORDER.filter((severity) => (scan.bySeverity[severity] ?? 0) > 0).map(
    (severity) => `${scan.bySeverity[severity]} ${severity}`,
  );
  const breakdown = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${when} — ${total} ${pluralize(total, "finding")}${breakdown}`;
}

export default function OverviewPage() {
  const orgId = useOrgId();
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<unknown>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      await api.getOrg(orgId);
      const scans = await api.listScans(orgId);
      // Newest first — "the latest scan" everything below refers to is scans[0].
      const sorted = [...scans].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      const latest = sorted[0];
      // Fleet and repos are supporting context; a deployment without them should
      // still render an overview rather than an error.
      const [latestFindings, fleet, repos] = await Promise.all([
        latest ? api.getFindings(latest.id) : Promise.resolve([]),
        api.getFleet(orgId).catch(() => undefined),
        api.getRepos(orgId).catch(() => []),
      ]);
      setData({ scans: sorted, latestFindings, latestRepo: latest?.repo, fleet, repos });
      setStatus("ready");
    } catch (err) {
      setFailure(err);
      setStatus("unreachable");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") return <PageSkeleton stats={4} rows={6} />;

  const description = "Everything Gatepass found for this organization, and a way into every surface it runs.";

  if (status === "unreachable") {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={description} />
        <ErrorPanel error={failure} context={{ action: "load the overview" }} onRetry={() => void load()} />
        <SurfaceGrid />
      </div>
    );
  }

  const scans = data?.scans ?? [];
  const latestFindings = data?.latestFindings ?? [];

  if (scans.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={description} />
        <EmptyState
          icon={<Radar className="h-5 w-5" aria-hidden="true" />}
          title="No scans yet"
          description="Nothing has been scanned for this organization. Run a scan and its findings will appear here."
          action={
            <Link
              href="/scans"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-action px-4 text-[0.855rem] font-medium text-action-text transition-colors duration-150 hover:bg-action-hover"
            >
              <Radar size={16} aria-hidden="true" />
              Run the first scan
            </Link>
          }
        />
        <SurfaceGrid />
      </div>
    );
  }

  const totalScans = scans.length;
  const totalVerified = scans.reduce((n, s) => n + s.verified, 0);
  const totalResearch = scans.reduce((n, s) => n + s.research, 0);
  const totalCritical = scans.reduce((n, s) => n + (s.bySeverity.critical ?? 0), 0);
  const scansWithCritical = scans.filter((s) => (s.bySeverity.critical ?? 0) > 0).length;
  const totalFindings = totalVerified + totalResearch;
  const latestScannedAt = scans[0]?.createdAt;

  const share = (part: number) => {
    const pct = sharePercent(part, totalFindings);
    return pct && `${pct} of all findings`;
  };

  const repo = repoLabel(data?.latestRepo);
  const fleet = data?.fleet;
  const repoCount = data?.repos.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={description}
        actions={
          <Link
            href="/scans"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.78rem] font-medium text-fg-secondary transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-fg"
          >
            All scans
          </Link>
        }
      />

      {/* Totals summed across every scan — no figure here is estimated. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Verified findings"
          value={totalVerified}
          tone="verified"
          icon={<ShieldCheck size={16} aria-hidden="true" />}
          caption={share(totalVerified)}
        />
        <Stat
          label="Research findings"
          value={totalResearch}
          tone="research"
          icon={<FlaskConical size={16} aria-hidden="true" />}
          caption={share(totalResearch)}
        />
        <Stat
          label="Critical"
          value={totalCritical}
          tone="critical"
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          caption={
            totalCritical > 0 ? `In ${scansWithCritical} of ${totalScans} ${pluralize(totalScans, "scan")}` : undefined
          }
        />
        <Stat
          label="Scans"
          value={totalScans}
          tone="neutral"
          icon={<Radar size={16} aria-hidden="true" />}
          caption={latestScannedAt ? `Latest ${relativeTime(latestScannedAt)}` : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card
          header={
            <CardTitle
              action={
                <span data-numeric className="shrink-0 text-[0.72rem] text-fg-muted">
                  {totalScans} {pluralize(totalScans, "scan")}
                </span>
              }
            >
              Findings by scan
            </CardTitle>
          }
        >
          <ScanChart scans={scans} />
        </Card>

        <Card header={<CardTitle>Coverage</CardTitle>}>
          <dl className="space-y-3.5">
            <CoverageRow
              label="Repositories connected"
              value={repoCount}
              href="/repos"
              note={repoCount === 0 ? "No GitHub App installation reachable" : undefined}
            />
            <CoverageRow
              label="MCP servers registered"
              value={fleet?.rollup.total ?? 0}
              href="/fleet"
              note={
                fleet && fleet.rollup.total > 0
                  ? `${fleet.rollup.critical} critical · ${fleet.rollup.unscanned} unscanned`
                  : "Nothing registered yet"
              }
            />
            <CoverageRow
              label="Findings in latest scan"
              value={latestFindings.length}
              href="/findings"
              note={repo ? `From ${repo}` : undefined}
            />
          </dl>
        </Card>
      </div>

      <Card
        padding={false}
        header={
          <CardTitle
            icon={<FileText size={15} aria-hidden="true" />}
            action={
              <Link
                href="/findings"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.78rem] font-medium text-fg-secondary transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-fg"
              >
                View all
              </Link>
            }
          >
            {repo ? `Latest findings — ${repo}` : "Latest findings"}
          </CardTitle>
        }
        footer={
          latestFindings.length > MAX_ROWS ? (
            <p className="text-[0.72rem] text-fg-muted">
              Showing {MAX_ROWS} of {latestFindings.length} findings from this scan.{" "}
              <Link href="/findings" className="cursor-pointer text-accent hover:underline">
                View all
              </Link>
            </p>
          ) : undefined
        }
      >
        <LatestFindingsTable findings={latestFindings} />
      </Card>

      <SurfaceGrid />
    </div>
  );
}

/** One line of the coverage panel: a count that links to the surface it counts. */
function CoverageRow({ label, value, href, note }: { label: string; value: number; href: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3.5 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[0.82rem] text-fg-secondary">{label}</dt>
        {note && <dd className="mt-0.5 text-[0.72rem] text-fg-muted">{note}</dd>}
      </div>
      <dd className="shrink-0">
        <Link
          href={href}
          data-numeric
          className="inline-flex cursor-pointer items-center gap-1 text-[1.05rem] font-medium text-fg transition-colors hover:text-accent"
        >
          {value}
          <ArrowUpRight size={13} className="text-fg-muted" aria-hidden="true" />
        </Link>
      </dd>
    </div>
  );
}

/**
 * The launcher. Rendered on every state of this page — including the two failure
 * states, because "the API is down" is exactly when someone needs to reach
 * /system, and a dead overview that also hides the navigation is two problems.
 */
function SurfaceGrid() {
  return (
    <section aria-labelledby="surfaces-heading">
      <div className="mb-3 flex items-center gap-4">
        <h2 id="surfaces-heading" className="text-[0.7rem] font-medium tracking-[0.11em] text-fg-muted uppercase">
          All surfaces
        </h2>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="group flex h-full cursor-pointer gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors duration-150 hover:border-line-strong hover:bg-raised"
            >
              <s.icon size={16} className="mt-0.5 shrink-0 text-fg-muted group-hover:text-accent" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[0.855rem] font-medium text-fg">{s.label}</span>
                <span className="mt-1 block text-[0.75rem] leading-relaxed text-fg-muted">{s.blurb}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScanChart({ scans }: { scans: ScanSummary[] }) {
  // Oldest first, so the chart reads left-to-right in time. The caller keeps its
  // own newest-first ordering for everything else on the page.
  const chronological = [...scans].reverse();
  const totals = chronological.map(scanTotal);
  const maxTotal = Math.max(1, ...totals);
  // Thin the axis labels out rather than letting them collide once history grows.
  const labelEvery = Math.max(1, Math.ceil(chronological.length / 8));

  return (
    <div>
      {/*
        Focusable and labelled because it scrolls: a keyboard user must be able
        to reach the scroll container. The bars themselves are hidden from
        assistive tech — the table below carries the same numbers losslessly.
      */}
      <div
        role="group"
        tabIndex={0}
        aria-label="Findings by scan, oldest first. The same figures are listed in the table that follows."
        className="overflow-x-auto pb-1"
      >
        <div className="flex items-end gap-2" aria-hidden="true">
          {chronological.map((scan, i) => {
            const total = totals[i] ?? 0;
            // `flex-col-reverse` places the first child at the bottom, so walk
            // the ordinal ramp backwards to stack critical on top.
            const segments = [...SEVERITY_ORDER]
              .reverse()
              .map((severity) => ({ severity, count: scan.bySeverity[severity] ?? 0 }))
              .filter((segment) => segment.count > 0);

            return (
              <div
                key={scan.id}
                className="flex shrink-0 flex-col items-center"
                style={{ width: COLUMN_WIDTH }}
                title={describeScan(scan, i)}
              >
                <div className="flex w-full flex-col-reverse justify-start" style={{ height: BAR_AREA }}>
                  {total === 0 ? (
                    // A clean scan still happened; a baseline says so without
                    // implying a count.
                    <div className="w-full bg-line-strong" style={{ height: MIN_SEGMENT }} />
                  ) : (
                    segments.map((segment) => (
                      <div
                        key={segment.severity}
                        className="w-full"
                        style={{
                          height: Math.max(MIN_SEGMENT, (segment.count / maxTotal) * BAR_AREA),
                          // Severity names are exactly the data-tone names, so
                          // the ramp maps 1:1 onto the token variables.
                          backgroundColor: TONE_VAR[segment.severity],
                        }}
                      />
                    ))
                  )}
                </div>
                <span className="mt-2 h-4 w-full truncate text-center text-[0.7rem] text-fg-muted">
                  {i % labelEvery === 0 ? relativeTime(scan.createdAt) || `#${i + 1}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/*
        A bar chart is not readable by a screen reader. Same counts, verbatim.

        The `sr-only` goes on a wrapping div, not on the table. `sr-only` works by
        clamping to 1px and clipping, and a table ignores a width that small — it
        sizes to its content regardless. Visually it stayed hidden, but it still
        counted toward the document's scroll width, which is what put a 45px
        horizontal scrollbar on the whole dashboard at 375px.
      */}
      <div className="sr-only">
        <table>
          <caption>Findings by scan and severity, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">Scan</th>
              {SEVERITY_ORDER.map((severity) => (
                <th key={severity} scope="col">
                  {severityLabel(severity)}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {chronological.map((scan, i) => (
              <tr key={scan.id}>
                <th scope="row">{scan.createdAt ? formatDate(scan.createdAt) : `Scan ${i + 1}`}</th>
                {SEVERITY_ORDER.map((severity) => (
                  <td key={severity}>{scan.bySeverity[severity] ?? 0}</td>
                ))}
                <td>{totals[i] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {SEVERITY_ORDER.map((severity) => (
          <li key={severity} className="flex items-center gap-1.5 text-[0.72rem] text-fg-muted">
            <span className={cx("h-2 w-2 shrink-0", TONE_FILL[severity])} aria-hidden="true" />
            {severityLabel(severity)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tier is the product's core claim, so it is spelled out rather than colour-coded. */
function TierBadge({ finding }: { finding: Finding }) {
  if (finding.tier === "verified") {
    return (
      <Badge tone="verified" dot>
        Verified
      </Badge>
    );
  }
  return (
    <Badge tone="research" dot>
      Research {confidencePercent(finding.confidence)}
    </Badge>
  );
}

function LatestFindingsTable({ findings }: { findings: Finding[] }) {
  const rows = findings.slice(0, MAX_ROWS);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[38rem] text-[0.855rem]">
        <caption className="sr-only">Findings from the most recent scan</caption>
        <thead>
          <tr className="border-b border-line bg-sunken">
            {["Vulnerability", "Path", "Tier", "Severity"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="px-4 py-2.5 text-left text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-10 text-center text-[0.82rem] text-fg-muted">
                No findings in the latest scan.
              </td>
            </tr>
          ) : (
            rows.map((finding) => {
              const location = finding.locations[0];
              const where = location ? `${location.path}:${location.startLine}` : undefined;
              return (
                <tr
                  key={finding.fingerprint}
                  className="border-b border-line transition-colors last:border-b-0 hover:bg-raised/60"
                >
                  <td className="px-4 py-3 font-medium text-fg">{finding.classId}</td>
                  <td className="px-4 py-3 text-fg-muted">
                    {where ? (
                      <span className="block max-w-[20rem] truncate font-mono text-[0.76rem]" title={where}>
                        {where}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge finding={finding} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={finding.severity} dot>
                      {severityLabel(finding.severity)}
                    </Badge>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
