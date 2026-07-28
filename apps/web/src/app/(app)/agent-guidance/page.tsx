"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, ListFilter, Lock } from "lucide-react";

import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import { ApiError, type Finding, type ScanSummary } from "@/lib/types";
import {
  confidencePercent,
  cx,
  pluralize,
  relativeTime,
  repoLabel,
  severityLabel,
  severityToken,
  tierToken,
} from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  CodeBlock,
  EmptyState,
  ErrorPanel,
  PageHeader,
  Select,
  Skeleton,
  TONE_VAR,
  type Tone,
} from "@/components/ui";

const DESCRIPTION = "Fetch the agent loop's remediation guidance for a finding from one of this organization's scans.";

/** `severityToken`/`tierToken` return token *names*; `Tone` is that same
 *  vocabulary narrowed for the primitives, so the cast is total by construction. */
const asTone = (token: string): Tone => token as Tone;

/** Every part of the label is a field the scan summary actually returned —
 *  repo path tail, age, and the verified + research total. */
function scanOptionLabel(scan: ScanSummary): string {
  const parts: string[] = [repoLabel(scan.repo) ?? scan.id];
  const age = relativeTime(scan.createdAt);
  if (age) parts.push(age);
  const total = scan.verified + scan.research;
  parts.push(`${total} ${pluralize(total, "finding")}`);
  return parts.join(" · ");
}

type Outcome =
  | { kind: "guidance"; fingerprint: string; guidance: { kind: string; content: string } }
  | { kind: "gated" }
  | { kind: "error"; error: unknown };

export default function AgentGuidancePage() {
  const router = useRouter();

  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [scansError, setScansError] = useState<unknown>(null);
  const [scanId, setScanId] = useState("");

  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [findingsError, setFindingsError] = useState<unknown>(null);
  const [fingerprint, setFingerprint] = useState("");

  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const loadScans = useCallback(async () => {
    setScansError(null);
    setScans(null);
    try {
      const list = await api.listScans(ORG_ID);
      // Newest first: the scan someone wants guidance on is nearly always the
      // last one that ran, so it is what the Select opens on.
      const sorted = [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setScans(sorted);
      setScanId((current) => current || (sorted[0]?.id ?? ""));
    } catch (err) {
      setScansError(err);
    }
  }, []);

  useEffect(() => {
    void loadScans();
  }, [loadScans]);

  // Findings follow the selected scan. A fingerprint from the previous scan is
  // meaningless against this one, so the selection resets with the fetch.
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    setFindings(null);
    setFindingsError(null);
    setFingerprint("");
    setOutcome(null);
    api
      .getFindings(scanId)
      .then((list) => {
        if (!cancelled) setFindings(list);
      })
      .catch((err) => {
        if (!cancelled) setFindingsError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  async function requestGuidance(event?: React.FormEvent) {
    event?.preventDefault();
    if (!scanId || !fingerprint) return;
    setLoading(true);
    setOutcome(null);
    try {
      const result = await api.getAgentGuidance(ORG_ID, scanId, fingerprint);
      setOutcome({ kind: "guidance", fingerprint: result.fingerprint, guidance: result.guidance });
    } catch (err) {
      // 403 is the opt-in gate in `agentGuidance`, not a failure. The previous
      // version matched on the word "Forbidden", which the API never sends —
      // the status code is the only reliable signal.
      if (err instanceof ApiError && err.status === 403) setOutcome({ kind: "gated" });
      else setOutcome({ kind: "error", error: err });
    } finally {
      setLoading(false);
    }
  }

  // ErrorState carries role="alert" of its own, so the error case is left out
  // here rather than announced twice.
  const status = loading
    ? "Requesting guidance"
    : outcome?.kind === "guidance"
      ? "Guidance loaded"
      : outcome?.kind === "gated"
        ? "Agent loop is disabled for this organization"
        : "";

  return (
    <div className="space-y-6">
      <PageHeader title="Agent guidance" description={DESCRIPTION} />

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {scansError ? (
        <ErrorPanel error={scansError} context={{ action: "load scans" }} onRetry={() => void loadScans()} />
      ) : scans === null ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading scans</span>
          <Skeleton variant="row" />
          <Skeleton variant="card" />
        </div>
      ) : scans.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-5 w-5" />}
          title="No scans yet"
          description="Guidance is generated from a finding in a completed scan, and this organization has no scans."
        />
      ) : (
        <>
          <Card header={<CardTitle icon={<ListFilter size={15} />}>Select a finding</CardTitle>}>
            <form onSubmit={requestGuidance} className="space-y-5">
              <Select
                label="Scan"
                value={scanId}
                onChange={(e) => setScanId(e.target.value)}
                options={scans.map((scan) => ({ value: scan.id, label: scanOptionLabel(scan) }))}
              />

              <fieldset className="min-w-0">
                <legend className="text-[0.78rem] font-medium text-fg-secondary">Finding</legend>

                {findingsError ? (
                  <div className="mt-1.5">
                    <ErrorPanel error={findingsError} context={{ action: "load findings" }} />
                  </div>
                ) : findings === null ? (
                  <div className="mt-1.5 space-y-2" aria-busy="true" aria-live="polite">
                    <span className="sr-only">Loading findings</span>
                    <Skeleton variant="row" />
                    <Skeleton variant="row" />
                  </div>
                ) : findings.length === 0 ? (
                  /* Not an EmptyState: nesting that bordered surface inside a
                     card reads as a second panel. The claim is the same. */
                  <p className="mt-1.5 rounded-[0.6rem] border border-line bg-sunken px-3 py-6 text-center text-[0.8rem] text-fg-muted">
                    This scan reported no findings.
                  </p>
                ) : (
                  <ul className="mt-1.5 max-h-[22rem] space-y-1 overflow-y-auto rounded-[0.6rem] border border-line bg-sunken p-1.5">
                    {findings.map((finding) => {
                      const selected = finding.fingerprint === fingerprint;
                      const location = finding.locations[0];
                      const tierLabel =
                        finding.tier === "verified" ? "Verified" : `Research ${confidencePercent(finding.confidence)}`;
                      const inputId = `finding-${finding.fingerprint}`;

                      return (
                        <li key={finding.fingerprint}>
                          <label
                            htmlFor={inputId}
                            className={cx(
                              "flex cursor-pointer items-start gap-2.5 rounded-[0.5rem] border px-2.5 py-2 transition-colors duration-150",
                              selected ? "border-accent-line bg-accent-soft" : "border-transparent hover:bg-raised",
                            )}
                          >
                            <input
                              id={inputId}
                              type="radio"
                              name="finding"
                              value={finding.fingerprint}
                              checked={selected}
                              onChange={() => setFingerprint(finding.fingerprint)}
                              className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer"
                              style={{ accentColor: TONE_VAR.accent }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[0.82rem] font-medium break-all text-fg">{finding.classId}</span>
                                <Badge size="sm" tone={asTone(severityToken(finding.severity))} dot>
                                  {severityLabel(finding.severity)}
                                </Badge>
                                <Badge size="sm" tone={asTone(tierToken(finding.tier))}>
                                  {tierLabel}
                                </Badge>
                              </span>
                              {location && (
                                <span className="mt-0.5 block font-mono text-[0.7rem] break-all text-fg-muted">
                                  {location.path}:{location.startLine}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>

              <div className="flex justify-end">
                <Button type="submit" variant="primary" isLoading={loading} disabled={!fingerprint}>
                  Get guidance
                </Button>
              </div>
            </form>
          </Card>

          {outcome?.kind === "guidance" ? (
            <Card
              header={
                <CardTitle
                  icon={<Lightbulb size={15} />}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setOutcome(null)}>
                      Dismiss
                    </Button>
                  }
                >
                  Guidance
                </CardTitle>
              }
            >
              <p className="text-[0.72rem] text-fg-muted">
                Fingerprint <span className="font-mono break-all text-fg-secondary">{outcome.fingerprint}</span>
              </p>
              <div className="mt-3">
                <CodeBlock title={outcome.guidance.kind} content={outcome.guidance.content} diff />
              </div>
            </Card>
          ) : outcome?.kind === "gated" ? (
            <EmptyState
              icon={<Lock className="h-5 w-5" />}
              title="Agent loop is off for this organization"
              description="The API declined the request because agent-loop guidance is disabled. Turn on Agent loop in Settings, then try again."
              action={{ label: "Open settings", onClick: () => router.push("/settings") }}
            />
          ) : outcome?.kind === "error" ? (
            <ErrorPanel
              error={outcome.error}
              context={{ action: "fetch guidance" }}
              onRetry={() => void requestGuidance()}
            />
          ) : (
            <EmptyState
              icon={<Lightbulb className="h-5 w-5" />}
              title="No guidance requested"
              description="Choose a scan and a finding above, then select Get guidance."
            />
          )}
        </>
      )}
    </div>
  );
}
