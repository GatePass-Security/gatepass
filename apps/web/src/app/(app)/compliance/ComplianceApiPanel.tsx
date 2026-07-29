"use client";

import { useState } from "react";
import { PlayCircle, Server } from "lucide-react";
import type { ComplianceDomain, ComplianceResult } from "@gatepass/compliance";
import { api } from "@/lib/api-client";
import { useOrgId } from "@/providers/SessionProvider";
import { Badge, Button, Card, CardTitle, ErrorState, Input, useToast } from "@/components/ui";
import { explainError, type FriendlyError } from "@/lib/errors";
import { formatDate, pluralize } from "@/lib/utils";

/**
 * Runs the API's compliance scanner against a path on the API host.
 *
 * The page around this renders a scan of the dashboard's own workspace, which
 * needs no configuration but can only ever assess one codebase — the one this
 * process happens to be running in. `POST /v1/orgs/:org/compliance/scan` and
 * `GET /v1/orgs/:org/compliance/results/:scanId` are the routes that assess any
 * other, and neither had a way in from the UI. The browser cannot hand the API a
 * directory it cannot see, so the input is a path on the API host — the same
 * contract the local-path code scan already uses.
 */
const DOMAIN_LABEL: Record<ComplianceDomain, string> = {
  wcag: "WCAG 2.2",
  ccpa: "CCPA/CPRA",
  app_store: "App Store",
  google_play: "Google Play",
  eu_ai_act: "EU AI Act",
};

/** The store returns `result` as `unknown`; this narrows it before anything reads a field. */
function asResult(value: unknown): ComplianceResult | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Partial<ComplianceResult>;
  return typeof r.score === "number" && typeof r.totalChecks === "number" ? (value as ComplianceResult) : null;
}

export function ComplianceApiPanel() {
  const orgId = useOrgId();
  const { toast } = useToast();
  const [repoPath, setRepoPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  async function run() {
    const target = repoPath.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const record = await api.complianceScan(orgId, target);
      const parsed = asResult(record.result);
      if (!parsed) {
        // A stored record whose payload is not a ComplianceResult is a real
        // failure, not something to render an empty scorecard for.
        setError(explainError(new Error("The API returned a compliance record this dashboard could not read.")));
      } else {
        setResult(parsed);
        setScanId(record.scanId);
        toast(`Assessed ${parsed.totalChecks} ${pluralize(parsed.totalChecks, "check")}`, "success");
      }
    } catch (err) {
      setError(explainError(err, { action: "run the compliance scan" }));
    } finally {
      setBusy(false);
    }
  }

  /** Re-reads a completed scan through `GET .../compliance/results/:scanId`. */
  async function reload() {
    if (!scanId) return;
    setBusy(true);
    setError(null);
    try {
      const record = await api.complianceResult(orgId, scanId);
      const parsed = asResult(record.result);
      if (parsed) setResult(parsed);
      else setError(explainError(new Error("The stored record could not be read.")));
    } catch (err) {
      setError(explainError(err, { subject: "compliance scan", action: "reload that scan" }));
    } finally {
      setBusy(false);
    }
  }

  const domains = result
    ? (Object.entries(result.byDomain) as Array<
        [ComplianceDomain, { total: number; pass: number; fail: number; score: number }]
      >)
    : [];

  return (
    <Card header={<CardTitle icon={<Server size={15} aria-hidden="true" />}>Assess another codebase</CardTitle>}>
      <p className="text-[0.82rem] leading-relaxed text-fg-secondary">
        The posture below is this dashboard&rsquo;s own workspace. To assess a different codebase, give Gatepass a
        directory the API process can read — nothing is uploaded, the scanner runs where the files already are.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Directory on the API host"
            placeholder="/srv/checkouts/my-app"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button variant="secondary" size="md" isLoading={busy} disabled={!repoPath.trim()} onClick={() => void run()}>
          <PlayCircle size={15} aria-hidden="true" />
          Run scan
        </Button>
      </div>

      {error && <ErrorState error={error} className="mt-4" />}

      {result && (
        <div className="mt-5 border-t border-line pt-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <span data-numeric className="text-[1.5rem] leading-none font-medium tracking-[-0.03em] text-fg">
                {result.score}
                <span className="text-fg-muted">/100</span>
              </span>
              <p className="mt-1.5 text-[0.75rem] text-fg-muted">
                {result.passCount} passed · {result.failCount} failed · {result.manualCount} manual · {result.naCount}{" "}
                not applicable
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[0.7rem] text-fg-muted">{formatDate(result.timestamp)}</span>
              <Button variant="ghost" size="sm" isLoading={busy} onClick={() => void reload()}>
                Reload
              </Button>
            </div>
          </div>

          <ul className="mt-4 flex flex-wrap gap-2">
            {domains.map(([domain, d]) => (
              <li key={domain}>
                {/* A domain with nothing applicable scores 100 by construction, so it
                    is shown as unassessed rather than as a clean sweep. */}
                <Badge tone={d.total === 0 ? "neutral" : d.fail > 0 ? "critical" : "verified"} dot={d.total > 0}>
                  {DOMAIN_LABEL[domain] ?? domain} {d.total === 0 ? "—" : `${d.score}/100`}
                </Badge>
              </li>
            ))}
          </ul>

          {scanId && <p className="mt-3 font-mono text-[0.7rem] break-all text-fg-muted">scan {scanId}</p>}
        </div>
      )}
    </Card>
  );
}
