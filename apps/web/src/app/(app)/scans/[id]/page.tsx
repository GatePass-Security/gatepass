"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileCheck2, GitPullRequest, Lightbulb, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import { errorToast, explainError, type FriendlyError } from "@/lib/errors";
import type { Finding, GateConfig, GateFailureMode, GateMode, GateResult, ScanSummary, Severity } from "@/lib/types";
import {
  SEVERITY_ORDER,
  confidencePercent,
  formatDate,
  pluralize,
  relativeTime,
  repoLabel,
  severityLabel,
} from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorPanel,
  ErrorState,
  PageHeader,
  PageSkeleton,
  Select,
  Stat,
  useToast,
} from "@/components/ui";

/**
 * One scan, end to end.
 *
 * This page exists because three capabilities the API has always exposed had no
 * route into them from the dashboard: the SARIF export
 * (`GET /v1/scans/:id/findings.sarif`), the merge-gate decision
 * (`POST /v1/scans/:id/gate`), and per-scan agent guidance. The gate in
 * particular is the product's blocking verdict, and the constitution forbids
 * writing to customer CI — so being able to ask "what would this policy do to
 * this scan?" here, with nothing posted anywhere, is the only safe way to tune
 * one before enabling it on a repo.
 */
type Status = "loading" | "ready" | "error";

const GATE_MODES: Array<{ value: GateMode; label: string }> = [
  { value: "off", label: "Off — report only" },
  { value: "block_verified", label: "Block on any verified finding" },
  { value: "block_threshold", label: "Block above a severity threshold" },
];

const FAILURE_MODES: Array<{ value: GateFailureMode; label: string }> = [
  { value: "fail_open", label: "Fail open — neutral check if the scan did not complete" },
  { value: "fail_closed", label: "Fail closed — block if the scan did not complete" },
];

const CONCLUSION_TONE = {
  success: "verified",
  failure: "critical",
  neutral: "neutral",
} as const;

export default function ScanDetailPage() {
  const params = useParams<{ id: string }>();
  const scanId = params.id;
  const { toast } = useToast();

  const [findings, setFindings] = useState<Finding[]>([]);
  const [scan, setScan] = useState<ScanSummary | undefined>();
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<unknown>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      // The router has no `GET /v1/scans/:id`, so the summary comes from the
      // org's list. Findings are the authoritative per-scan payload either way.
      const [rows, list] = await Promise.all([api.getFindings(scanId), api.listScans(ORG_ID).catch(() => [])]);
      setFindings(rows);
      setScan(list.find((s) => s.id === scanId));
      setStatus("ready");
    } catch (err) {
      setFailure(err);
      setStatus("error");
    }
  }, [scanId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const bySeverity = {} as Record<Severity, number>;
    for (const s of SEVERITY_ORDER) bySeverity[s] = 0;
    let verified = 0;
    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      if (f.tier === "verified") verified += 1;
    }
    return { bySeverity, verified, research: findings.length - verified };
  }, [findings]);

  if (status === "loading") return <PageSkeleton stats={4} rows={6} />;

  if (status === "error") {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader title="Scan" description={`Scan ${scanId}`} />
        <ErrorPanel
          error={failure}
          context={{ subject: "scan", action: "load this scan" }}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const target = repoLabel(scan?.repo) ?? "Scan";

  async function downloadSarif() {
    try {
      const doc = await api.getSarif(scanId);
      // Built in the browser from the API's own response, so the file is exactly
      // what a CI consumer would receive from the endpoint.
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gatepass-${scanId}.sarif.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("SARIF export downloaded", "success");
    } catch (err) {
      toast(errorToast(err, { action: "export SARIF" }), "error");
    }
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={target}
        description={
          scan?.createdAt ? `Scanned ${relativeTime(scan.createdAt)} · ${formatDate(scan.createdAt)}` : `Scan ${scanId}`
        }
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => void downloadSarif()}>
              <Download size={15} aria-hidden="true" />
              SARIF
            </Button>
            <Link
              href={`/agent-guidance?scan=${encodeURIComponent(scanId)}`}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-action px-4 text-[0.855rem] font-medium text-action-text transition-colors duration-150 hover:bg-action-hover"
            >
              <Lightbulb size={15} aria-hidden="true" />
              Fix guidance
            </Link>
          </>
        }
      />

      {scan?.repo && <p className="-mt-2 font-mono text-[0.75rem] break-all text-fg-muted">{scan.repo}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Verified"
          value={counts.verified}
          tone="verified"
          icon={<ShieldCheck size={16} aria-hidden="true" />}
        />
        <Stat label="Research" value={counts.research} tone="research" />
        <Stat label="Critical" value={counts.bySeverity.critical ?? 0} tone="critical" />
        <Stat label="Total findings" value={findings.length} tone="neutral" />
      </div>

      <GatePreview scanId={scanId} findingCount={findings.length} />

      <Card
        padding={false}
        header={
          <CardTitle
            icon={<FileCheck2 size={15} aria-hidden="true" />}
            action={
              <Link
                href={`/findings?scan=${encodeURIComponent(scanId)}`}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.78rem] font-medium text-fg-secondary transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-fg"
              >
                Filter &amp; triage
              </Link>
            }
          >
            {findings.length} {pluralize(findings.length, "finding")}
          </CardTitle>
        }
      >
        <FindingsTable findings={findings} />
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/scans"
      className="inline-flex cursor-pointer items-center gap-1.5 text-[0.78rem] text-fg-muted transition-colors hover:text-fg"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      All scans
    </Link>
  );
}

/**
 * The merge gate, run against this scan without touching a pull request.
 *
 * `evaluateGate` is a pure decision over the scan's findings, so changing the
 * policy here and re-running it costs nothing and changes nothing outside this
 * card. The result is deliberately phrased as "would" — Gatepass never writes
 * to customer CI, and this page must not read as though it just did.
 */
function GatePreview({ scanId, findingCount }: { scanId: string; findingCount: number }) {
  const [mode, setMode] = useState<GateMode>("block_verified");
  const [failureMode, setFailureMode] = useState<GateFailureMode>("fail_open");
  const [minSeverity, setMinSeverity] = useState<Severity>("high");
  const [maxAllowed, setMaxAllowed] = useState(0);
  const [result, setResult] = useState<GateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const config: GateConfig = {
        mode,
        failureMode,
        ...(mode === "block_threshold" ? { threshold: { minSeverity, maxAllowed } } : {}),
      };
      setResult(await api.evaluateGate(scanId, config));
    } catch (err) {
      setError(explainError(err, { action: "evaluate the gate" }));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      header={
        <CardTitle icon={<GitPullRequest size={15} aria-hidden="true" />}>
          Merge gate — what this policy would do
        </CardTitle>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Select
            label="Gate mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as GateMode)}
            options={GATE_MODES}
          />
          <Select
            label="If the scan does not complete"
            value={failureMode}
            onChange={(e) => setFailureMode(e.target.value as GateFailureMode)}
            options={FAILURE_MODES}
          />
          {mode === "block_threshold" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Minimum severity"
                value={minSeverity}
                onChange={(e) => setMinSeverity(e.target.value as Severity)}
                options={SEVERITY_ORDER.map((s) => ({ value: s, label: severityLabel(s) }))}
              />
              <Select
                label="Findings allowed"
                value={String(maxAllowed)}
                onChange={(e) => setMaxAllowed(Number(e.target.value))}
                options={[0, 1, 2, 5, 10].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          )}
          <Button variant="secondary" size="md" isLoading={busy} onClick={() => void run()}>
            Evaluate against this scan
          </Button>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-sunken p-4">
          {error ? (
            <ErrorState error={error} />
          ) : result ? (
            <div aria-live="polite">
              <Badge tone={CONCLUSION_TONE[result.conclusion]} dot>
                {result.conclusion === "success"
                  ? "Would pass"
                  : result.conclusion === "failure"
                    ? "Would block the merge"
                    : "Neutral — no verdict"}
              </Badge>
              <p className="mt-3 text-[0.82rem] leading-relaxed text-fg-secondary">{result.summary}</p>
              {result.blocking.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {/* Worst first. The gate returns findings in scan order, which
                      buried the critical that is the actual reason for the block. */}
                  {[...result.blocking]
                    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
                    .slice(0, 6)
                    .map((f) => (
                      <li key={f.fingerprint} className="flex items-center gap-2 text-[0.78rem]">
                        <Badge tone={f.severity} size="sm">
                          {severityLabel(f.severity)}
                        </Badge>
                        <span className="truncate text-fg-secondary">{f.classId}</span>
                      </li>
                    ))}
                  {result.blocking.length > 6 && (
                    <li className="text-[0.75rem] text-fg-muted">and {result.blocking.length - 6} more</li>
                  )}
                </ul>
              )}
              <p className="mt-3 text-[0.72rem] text-fg-muted">
                Evaluated locally against this scan. Nothing was posted to a pull request.
              </p>
            </div>
          ) : (
            <p className="text-[0.82rem] leading-relaxed text-fg-muted">
              Pick a policy and evaluate it against this scan&rsquo;s {findingCount}{" "}
              {pluralize(findingCount, "finding")}. The result is a preview — Gatepass never writes to your CI
              configuration.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function FindingsTable({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="px-5 py-10 text-center text-[0.82rem] text-fg-muted">This scan produced no findings.</p>;
  }

  const ordered = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-[0.855rem]">
        <caption className="sr-only">Findings in this scan, most severe first</caption>
        <thead>
          <tr className="border-b border-line bg-sunken">
            {["Class", "Location", "Tier", "Severity"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-4 py-2.5 text-left text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((f) => {
            const loc = f.locations[0];
            const where = loc ? `${loc.path}:${loc.startLine}` : undefined;
            return (
              <tr
                key={f.fingerprint}
                className="border-b border-line transition-colors last:border-b-0 hover:bg-raised/60"
              >
                <td className="px-4 py-3 font-medium text-fg">{f.classId}</td>
                <td className="px-4 py-3 text-fg-muted">
                  {where ? (
                    <span className="block max-w-[22rem] truncate font-mono text-[0.76rem]" title={where}>
                      {where}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  {f.tier === "verified" ? (
                    <Badge tone="verified" dot>
                      Verified
                    </Badge>
                  ) : (
                    <Badge tone="research" dot>
                      Research {confidencePercent(f.confidence)}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={f.severity} dot>
                    {severityLabel(f.severity)}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
