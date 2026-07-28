"use client";

import { useState } from "react";
import { BarChart3, Crosshair, Database, Download, Target } from "lucide-react";
import type { BenchmarkData } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorPanel,
  PageHeader,
  Select,
  Stat,
  Table,
  TONE_FILL,
  TONE_TEXT,
  type Tone,
} from "@/components/ui";
import { cx, pluralize } from "@/lib/utils";

interface Props {
  data: BenchmarkData[];
  error: string | null;
}

type ToolRun = BenchmarkData["runs"][number];
type ClassRow = ToolRun["perClass"][number];

/** A class counts as "detected" when the tool produced at least one true positive for it. */
function detectedCount(run: ToolRun): number {
  return run.perClass.filter((pc) => pc.tp > 0).length;
}

/** Mean precision over classes where the tool actually flagged something (tp+fp>0). */
function meanPrecision(run: ToolRun): number | null {
  const scored = run.perClass.filter((pc) => pc.tp + pc.fp > 0);
  if (scored.length === 0) return null;
  return scored.reduce((s, pc) => s + pc.tp / (pc.tp + pc.fp), 0) / scored.length;
}

/**
 * Mean recall over all labeled classes, or null when the run has no per-class
 * results. Null rather than 0 for the same reason `meanPrecision` returns null:
 * a run that recorded nothing has an *undefined* recall, and rendering it as
 * "0.0%" in the failing tone scores a tool zero for data that does not exist —
 * while the table directly below says the run recorded no per-class results.
 */
function meanRecall(run: ToolRun): number | null {
  if (run.perClass.length === 0) return null;
  return run.perClass.reduce((s, pc) => s + pc.recall, 0) / run.perClass.length;
}

/**
 * The published thresholds (>=0.9, >=0.7) expressed on the shared data ramp, so a
 * rate on this page reads with the same weight as a severity does everywhere else.
 */
function rateTone(rate: number): Tone {
  if (rate >= 0.9) return "verified";
  if (rate >= 0.7) return "medium";
  return "critical";
}

function ratePercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export default function BenchmarkClient({ data, error }: Props) {
  const [selectedVersion, setSelectedVersion] = useState<string>(data[0]?.corpusVersion ?? "");
  const current = data.find((d) => d.corpusVersion === selectedVersion) ?? data[0];

  // The primary run (gatepass) drives the headline; other runs are the incumbent comparison.
  const runs = current?.runs ?? [];
  const primary = runs.find((r) => r.tool.toLowerCase().startsWith("gatepass")) ?? runs[0];
  const incumbents = runs.filter((r) => r !== primary);

  const totalClasses = primary?.perClass.length ?? 0;
  const primaryDetected = primary ? detectedCount(primary) : 0;
  const primaryPrecision = primary ? meanPrecision(primary) : null;
  const primaryRecall = primary ? meanRecall(primary) : null;
  // The precision denominator, surfaced so the headline says what it averaged over.
  const scoredClasses = primary ? primary.perClass.filter((pc) => pc.tp + pc.fp > 0).length : 0;

  function handleDownload() {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${current.corpusVersion}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const header = (
    <PageHeader
      title="Precision benchmark"
      description="Measured accuracy across vulnerability classes, scored identically for every tool. Headline figures describe a single run and are never averaged across tools."
      actions={
        current ? (
          <div className="flex items-end gap-2">
            <Select
              label="Corpus version"
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              options={data.map((d) => ({ value: d.corpusVersion, label: d.corpusVersion }))}
              className="min-w-[9rem]"
            />
            <Button variant="secondary" onClick={handleDownload}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Raw JSON
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={new Error(error)} context={{ action: "load the benchmark" }} />
      </div>
    );
  }

  // No corpus version, or a version carrying no runs — both mean "nothing published".
  if (!current || !primary) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No benchmark published yet"
          description="Nothing has been published to the public benchmark endpoint. An empty benchmark means no run has been recorded — it is not a score of zero for any tool."
        />
      </div>
    );
  }

  const orderedRuns = [primary, ...incumbents];
  const classWord = pluralize(totalClasses, "class", "classes");

  return (
    <div className="space-y-6">
      {header}

      {/* Headline metrics — the primary run only, never averaged with incumbents. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={`${primary.tool} — classes detected`}
          value={`${primaryDetected}/${totalClasses}`}
          icon={<Database className="h-4 w-4" aria-hidden="true" />}
          caption={`${totalClasses} labeled ${classWord} in ${current.corpusVersion}`}
        />
        <Stat
          label={`${primary.tool} — mean precision`}
          value={primaryPrecision === null ? "—" : ratePercent(primaryPrecision)}
          tone={primaryPrecision === null ? "neutral" : rateTone(primaryPrecision)}
          icon={<Target className="h-4 w-4" aria-hidden="true" />}
          caption={
            primaryPrecision === null
              ? "This run flagged nothing, so precision is undefined"
              : `Mean over ${scoredClasses} ${pluralize(scoredClasses, "class", "classes")} with at least one flag`
          }
        />
        <Stat
          label={`${primary.tool} — mean recall`}
          value={primaryRecall === null ? "—" : ratePercent(primaryRecall)}
          tone={primaryRecall === null ? "neutral" : rateTone(primaryRecall)}
          icon={<Crosshair className="h-4 w-4" aria-hidden="true" />}
          caption={
            primaryRecall === null
              ? "This run recorded no per-class results, so recall is undefined"
              : `Mean over all ${totalClasses} labeled ${classWord}`
          }
        />
      </div>

      {/* Head-to-head detection summary */}
      {incumbents.length > 0 && (
        <Card header={<CardTitle icon={<BarChart3 className="h-4 w-4" />}>Classes detected — head to head</CardTitle>}>
          <ul role="list" className="space-y-4">
            {orderedRuns.map((run) => {
              const detected = detectedCount(run);
              const pct = totalClasses ? (detected / totalClasses) * 100 : 0;
              const isPrimary = run === primary;
              const tone: Tone = isPrimary ? "accent" : "low";
              return (
                <li key={run.tool} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cx(
                          "truncate text-[0.8rem]",
                          isPrimary ? "font-medium text-fg" : "text-fg-secondary",
                        )}
                      >
                        {run.tool}
                      </span>
                      {isPrimary && (
                        <Badge tone="accent" size="sm">
                          Headline run
                        </Badge>
                      )}
                    </span>
                    <span
                      data-numeric
                      className={cx("shrink-0 text-[0.78rem]", isPrimary ? TONE_TEXT.accent : "text-fg-secondary")}
                    >
                      {detected}/{totalClasses}
                      <span className="text-fg-muted"> · {pct.toFixed(0)}%</span>
                    </span>
                  </div>
                  {/* Decoration only — the count and percentage above carry the value as text. */}
                  <span className="block h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                    <span className={cx("block h-full rounded-full", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Per-tool tables */}
      <section className="space-y-4" aria-labelledby="per-class-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="per-class-heading" className="text-[0.82rem] font-medium text-fg">
            Per-class results
          </h2>
          <p className="text-[0.78rem] text-fg-muted">
            Published: {new Date(current.publishedAt).toLocaleDateString()} · {runs.length} tool{" "}
            {pluralize(runs.length, "run")}
          </p>
        </div>

        {orderedRuns.map((run) => (
          <div key={run.tool} className="space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="flex items-center gap-2 text-[0.82rem] font-medium text-fg">
                {run.tool}
                {run === primary && (
                  <Badge tone="accent" size="sm">
                    Headline run
                  </Badge>
                )}
              </h3>
              <span data-numeric className="text-[0.72rem] text-fg-muted">
                {detectedCount(run)}/{run.perClass.length} {pluralize(run.perClass.length, "class", "classes")} detected
              </span>
            </div>
            <Table<ClassRow>
              caption={`Per-class benchmark results for ${run.tool}`}
              emptyMessage="This run recorded no per-class results."
              data={run.perClass}
              getRowKey={(row) => row.classId}
              columns={[
                {
                  key: "classId",
                  header: "Class",
                  render: (value) => <span className="font-mono text-[0.8rem] text-fg">{String(value)}</span>,
                },
                {
                  key: "tp",
                  header: "TP",
                  align: "right",
                  render: (value) => <span className={cx("font-mono", TONE_TEXT.verified)}>{String(value)}</span>,
                },
                {
                  key: "fp",
                  header: "FP",
                  align: "right",
                  render: (value) => <span className={cx("font-mono", TONE_TEXT.critical)}>{String(value)}</span>,
                },
                {
                  key: "fn",
                  header: "FN",
                  align: "right",
                  render: (value) => <span className="font-mono text-fg-muted">{String(value)}</span>,
                },
                {
                  key: "precision",
                  header: "Precision",
                  align: "right",
                  // Recomputed from tp/fp rather than read off `precision`, so the column
                  // and the headline mean are the same quantity by construction.
                  render: (_value, row) => {
                    const prec = row.tp + row.fp > 0 ? row.tp / (row.tp + row.fp) : null;
                    return prec === null ? (
                      <span className="font-mono text-fg-muted" title="No flags raised for this class">
                        —
                      </span>
                    ) : (
                      <span className={cx("font-mono font-medium", TONE_TEXT[rateTone(prec)])}>
                        {ratePercent(prec)}
                      </span>
                    );
                  },
                },
                {
                  key: "recall",
                  header: "Recall",
                  align: "right",
                  render: (_value, row) => (
                    <span className="font-mono font-medium text-fg">{ratePercent(row.recall)}</span>
                  ),
                },
              ]}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
