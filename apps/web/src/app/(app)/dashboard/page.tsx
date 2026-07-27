"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileText, FlaskConical, Plus, Radar, ShieldCheck, TrendingUp } from "lucide-react";
import { api } from "@/lib/api-client";
import { API_BASE, ORG_ID } from "@/lib/constants";
import type { Finding, ScanSummary } from "@/lib/types";
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
  ErrorState,
  PageHeader,
  PageSkeleton,
  Stat,
  TONE_FILL,
  TONE_VAR,
} from "@/components/ui";

/*
 * Chart geometry. The bars are HTML boxes rather than a stretched SVG so that a
 * history of one scan renders a single clean column instead of a bar smeared
 * across the card — the distortion the previous SVG version produced.
 */
const BAR_AREA = 160;
const COLUMN_WIDTH = 44;
/**
 * A count of 1 against a tall maximum rounds to sub-pixel and disappears. The
 * floor keeps a real finding visible; the exact figures are still carried by the
 * column's title and by the sr-only table, so nothing is overstated.
 */
const MIN_SEGMENT = 2;

/** The dashboard shows a slice of the latest scan; /findings has the whole set. */
const MAX_ROWS = 8;

const PILL_LINK =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 " +
  "text-[0.78rem] font-medium text-fg-secondary transition-colors duration-150 " +
  "hover:border-line-strong hover:bg-raised hover:text-fg";

const PRIMARY_LINK =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-action px-4 text-[0.855rem] " +
  "font-medium text-action-text transition-colors duration-150 hover:bg-action-hover";

interface Overview {
  scans: ScanSummary[];
  latestFindings: Finding[];
  latestRepo?: string;
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

export default function Home() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      await api.getOrg(ORG_ID);
      const scans = await api.listScans(ORG_ID);
      // Newest first — "the latest scan" everything below refers to is scans[0].
      const sorted = [...scans].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      const latest = sorted[0];
      const latestFindings = latest ? await api.getFindings(latest.id) : [];
      setData({ scans: sorted, latestFindings, latestRepo: latest?.repo });
      setStatus("ready");
    } catch {
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") return <PageSkeleton stats={4} rows={6} />;

  const description = "Finding totals and recent scan activity for this organization, summed across every scan.";

  if (status === "unreachable") {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description={description} />
        <ErrorState
          title="Gatepass API unreachable"
          message={`No response from the API at ${API_BASE}. Every figure on this page is read from that host, so nothing can be shown until it answers.`}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const scans = data?.scans ?? [];
  const latestFindings = data?.latestFindings ?? [];

  if (scans.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description={description} />
        <EmptyState
          icon={<Radar className="h-5 w-5" aria-hidden="true" />}
          title="No scans yet"
          description="Nothing has been scanned for this organization. Register a server or trigger a scan and its findings will appear here."
          action={
            <Link href="/fleet" className={PRIMARY_LINK}>
              <Plus size={16} aria-hidden="true" />
              Register a server
            </Link>
          }
        />
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={description}
        actions={
          <Link href="/findings" className={PILL_LINK}>
            All findings
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

      <Card
        header={
          <CardTitle
            icon={<TrendingUp size={15} aria-hidden="true" />}
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

      <Card
        padding={false}
        header={
          <CardTitle
            icon={<FileText size={15} aria-hidden="true" />}
            action={
              <Link href="/findings" className={PILL_LINK}>
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
    </div>
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
                    <div className="w-full rounded-[2px] bg-line-strong" style={{ height: MIN_SEGMENT }} />
                  ) : (
                    segments.map((segment) => (
                      <div
                        key={segment.severity}
                        className="w-full last:rounded-t-[3px]"
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

      {/* A bar chart is not readable by a screen reader. Same counts, verbatim. */}
      <table className="sr-only">
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

      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {SEVERITY_ORDER.map((severity) => (
          <li key={severity} className="flex items-center gap-1.5 text-[0.72rem] text-fg-muted">
            <span className={cx("h-2.5 w-2.5 shrink-0 rounded-[2px]", TONE_FILL[severity])} aria-hidden="true" />
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
