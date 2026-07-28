"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Radar, ScanLine } from "lucide-react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import type { ScanSummary } from "@/lib/types";
import { SEVERITY_ORDER, formatDate, pluralize, relativeTime, repoLabel, severityLabel } from "@/lib/utils";
import { Badge, Button, EmptyState, ErrorPanel, PageHeader, PageSkeleton, Stat, TONE_FILL } from "@/components/ui";
import { ScanRepoDialog } from "@/components/ScanRepoDialog";
import { cx } from "@/lib/utils";

/**
 * Scan history — the full list behind the overview's summary chart.
 *
 * `GET /v1/orgs/:org/scans` was already the overview's data source but there was
 * no page that showed all of it, so any scan older than the newest one could
 * only be reached by knowing its id. Each row links to the scan's own page,
 * which is where SARIF export and the gate preview live.
 */
type Status = "loading" | "ready" | "unreachable";

function total(scan: ScanSummary): number {
  return SEVERITY_ORDER.reduce((n, s) => n + (scan.bySeverity[s] ?? 0), 0);
}

export default function ScansPage() {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<unknown>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const rows = await api.listScans(ORG_ID);
      setScans([...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
      setStatus("ready");
    } catch (err) {
      setFailure(err);
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeScan = useCallback(() => {
    setScanOpen(false);
    void load();
  }, [load]);

  if (status === "loading") return <PageSkeleton stats={3} rows={8} />;

  const description =
    "Every scan this organization has run, newest first. Open one for its findings, SARIF export and gate result.";

  if (status === "unreachable") {
    return (
      <div className="space-y-6">
        <PageHeader title="Scans" description={description} />
        <ErrorPanel error={failure} context={{ action: "load scan history" }} onRetry={() => void load()} />
      </div>
    );
  }

  const verified = scans.reduce((n, s) => n + s.verified, 0);
  const research = scans.reduce((n, s) => n + s.research, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scans"
        description={description}
        actions={
          <Button variant="primary" size="md" onClick={() => setScanOpen(true)}>
            <ScanLine size={15} aria-hidden="true" />
            Run a scan
          </Button>
        }
      />

      {scans.length === 0 ? (
        <EmptyState
          icon={<Radar className="h-5 w-5" aria-hidden="true" />}
          title="No scans yet"
          description="Point Gatepass at a GitHub repository or a directory on the API host and its findings will appear here."
          action={
            <Button variant="primary" size="md" onClick={() => setScanOpen(true)}>
              <ScanLine size={15} aria-hidden="true" />
              Run a scan
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Scans" value={scans.length} tone="neutral" />
            <Stat label="Verified findings" value={verified} tone="verified" />
            <Stat label="Research findings" value={research} tone="research" />
          </div>

          <div className="gp-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[0.855rem]">
                <caption className="sr-only">Scan history, newest first</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken">
                    {["Target", "Ran", "Findings", "Severity", ""].map((h, i) => (
                      <th
                        key={h || `col-${i}`}
                        scope="col"
                        className="px-4 py-2.5 text-left text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase"
                      >
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scans.map((scan) => {
                    const count = total(scan);
                    return (
                      <tr
                        key={scan.id}
                        className="group border-b border-line transition-colors last:border-b-0 hover:bg-raised/60"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/scans/${scan.id}`} className="block min-w-0 cursor-pointer">
                            <span className="block truncate font-medium text-fg group-hover:text-accent">
                              {repoLabel(scan.repo) ?? "Unnamed target"}
                            </span>
                            <span className="mt-0.5 block max-w-[26rem] truncate font-mono text-[0.7rem] text-fg-muted">
                              {scan.repo ?? scan.id}
                            </span>
                          </Link>
                        </td>
                        <td
                          className="px-4 py-3 text-fg-muted"
                          title={scan.createdAt ? formatDate(scan.createdAt) : undefined}
                        >
                          {relativeTime(scan.createdAt) || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="verified" dot>
                              {scan.verified} verified
                            </Badge>
                            <Badge tone="research" dot>
                              {scan.research} research
                            </Badge>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {count === 0 ? (
                            <span className="text-[0.78rem] text-fg-muted">Clean</span>
                          ) : (
                            <SeverityStrip scan={scan} total={count} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/scans/${scan.id}`}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[0.75rem] text-fg-muted transition-colors hover:bg-raised hover:text-fg"
                          >
                            Open
                            <ChevronRight size={13} aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ScanRepoDialog open={scanOpen} onClose={closeScan} />
    </div>
  );
}

/**
 * A proportional severity bar for one scan. The counts are also written out
 * beside it — the bar is a shape to scan down the column, never the only way to
 * read the number.
 */
function SeverityStrip({ scan, total: count }: { scan: ScanSummary; total: number }) {
  const parts = SEVERITY_ORDER.map((severity) => ({ severity, n: scan.bySeverity[severity] ?? 0 })).filter(
    (p) => p.n > 0,
  );

  return (
    <span className="flex items-center gap-2">
      <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        {parts.map((p) => (
          <span
            key={p.severity}
            className={cx("h-full", TONE_FILL[p.severity])}
            style={{ width: `${(p.n / count) * 100}%` }}
          />
        ))}
      </span>
      <span data-numeric className="text-[0.75rem] text-fg-muted">
        {parts.map((p) => `${p.n} ${severityLabel(p.severity).toLowerCase()}`).join(", ")}
      </span>
      <span className="sr-only">
        {count} {pluralize(count, "finding")}
      </span>
    </span>
  );
}
