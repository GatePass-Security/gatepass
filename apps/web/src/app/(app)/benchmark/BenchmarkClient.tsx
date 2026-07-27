"use client";

import { useState } from "react";
import type { BenchmarkData } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { Download, BarChart3, Database, Target, Crosshair } from "lucide-react";

interface Props {
  data: BenchmarkData[];
  error: string | null;
}

interface ToolRun {
  tool: string;
  perClass: BenchmarkData["runs"][number]["perClass"];
}

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

/** Mean recall over all labeled classes. */
function meanRecall(run: ToolRun): number {
  if (run.perClass.length === 0) return 0;
  return run.perClass.reduce((s, pc) => s + pc.recall, 0) / run.perClass.length;
}

function rateColor(p: number): string {
  if (p >= 0.9) return "text-emerald-600 dark:text-emerald-400";
  if (p >= 0.7) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
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
  const primaryRecall = primary ? meanRecall(primary) : 0;

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

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={48} />}
        title="No benchmark data"
        description="Benchmark results will appear here once published"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gatepass-900 dark:text-gatepass-100">Precision Benchmark</h1>
          <p className="mt-1 text-sm text-gatepass-500">
            Measured accuracy across vulnerability classes, scored identically for every tool.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="rounded-lg border border-gatepass-200 bg-white px-4 py-2 text-sm text-gatepass-700 hover:border-gatepass-300 dark:border-gatepass-700 dark:bg-gatepass-800 dark:text-gatepass-200"
          >
            {data.map((d) => (
              <option key={d.corpusVersion} value={d.corpusVersion}>
                {d.corpusVersion}
              </option>
            ))}
          </select>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 bg-white px-4 py-2 text-sm font-medium text-gatepass-700 hover:bg-gatepass-50 hover:border-gatepass-300 dark:border-gatepass-700 dark:bg-gatepass-800 dark:text-gatepass-200 dark:hover:bg-gatepass-700"
          >
            <Download size={16} />
            Raw JSON
          </button>
        </div>
      </div>

      {/* Headline metrics — Gatepass only (not averaged with incumbents) */}
      {primary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Database size={20} className="text-[#0891b2]" />}
            value={`${primaryDetected}/${totalClasses}`}
            label="Classes detected (Gatepass)"
          />
          <StatCard
            icon={<Target size={20} className="text-[#0891b2]" />}
            value={primaryPrecision === null ? "—" : `${(primaryPrecision * 100).toFixed(1)}%`}
            label="Precision (Gatepass)"
            valueClass={primaryPrecision === null ? undefined : rateColor(primaryPrecision)}
          />
          <StatCard
            icon={<Crosshair size={20} className="text-[#0891b2]" />}
            value={`${(primaryRecall * 100).toFixed(1)}%`}
            label="Recall (Gatepass)"
            valueClass={rateColor(primaryRecall)}
          />
        </div>
      )}

      {/* Head-to-head detection summary */}
      {incumbents.length > 0 && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-5 dark:border-gatepass-800 dark:bg-gatepass-900">
          <h2 className="text-sm font-semibold text-gatepass-900 dark:text-gatepass-100">
            Classes detected — head to head
          </h2>
          <div className="mt-4 space-y-3">
            {[primary!, ...incumbents].map((run) => {
              const d = detectedCount(run);
              const pct = totalClasses ? (d / totalClasses) * 100 : 0;
              const isPrimary = run === primary;
              return (
                <div key={run.tool} className="flex items-center gap-3">
                  <span
                    className={`w-64 shrink-0 truncate text-xs ${isPrimary ? "font-semibold text-gatepass-900 dark:text-gatepass-100" : "text-gatepass-500"}`}
                    title={run.tool}
                  >
                    {run.tool}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-gatepass-100 dark:bg-gatepass-800">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: isPrimary ? "#0D9488" : "#94a3b8" }}
                    />
                  </div>
                  <span
                    className={`w-12 shrink-0 text-right text-xs font-medium ${isPrimary ? "text-gatepass-900 dark:text-gatepass-100" : "text-gatepass-500"}`}
                  >
                    {d}/{totalClasses}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-tool tables */}
      {current && (
        <div className="space-y-4">
          <p className="text-sm text-gatepass-500">
            Published: {new Date(current.publishedAt).toLocaleDateString()} &middot; {runs.length} tool run(s)
          </p>
          {[primary!, ...incumbents].filter(Boolean).map((run) => (
            <div
              key={run.tool}
              className="rounded-lg border border-gatepass-200 bg-white dark:border-gatepass-800 dark:bg-gatepass-900"
            >
              <div className="flex items-center justify-between border-b border-gatepass-200 px-4 py-3 dark:border-gatepass-800">
                <h3 className="text-sm font-semibold text-gatepass-900 dark:text-gatepass-100">{run.tool}</h3>
                <span className="text-xs text-gatepass-500">
                  {detectedCount(run)}/{run.perClass.length} classes
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gatepass-200 bg-gatepass-50 dark:border-gatepass-800 dark:bg-gatepass-800/50">
                      {["Class", "TP", "FP", "FN", "Precision", "Recall"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gatepass-500 ${i === 0 ? "text-left" : "text-right"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {run.perClass.map((pc) => {
                      const prec = pc.tp + pc.fp > 0 ? pc.tp / (pc.tp + pc.fp) : null;
                      return (
                        <tr
                          key={pc.classId}
                          className="border-b border-gatepass-100 last:border-b-0 hover:bg-gatepass-50/50 dark:border-gatepass-800 dark:hover:bg-gatepass-800/40"
                        >
                          <td className="px-4 py-2.5 font-mono text-sm text-gatepass-900 dark:text-gatepass-100">
                            {pc.classId}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm text-emerald-600 dark:text-emerald-400">
                            {pc.tp}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm text-red-600 dark:text-red-400">
                            {pc.fp}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm text-gatepass-500">{pc.fn}</td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono text-sm font-medium ${prec === null ? "text-gatepass-400" : rateColor(prec)}`}
                          >
                            {prec === null ? "—" : `${(prec * 100).toFixed(1)}%`}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm font-medium text-gatepass-900 dark:text-gatepass-100">
                            {(pc.recall * 100).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  valueClass,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-gatepass-200 bg-white p-5 dark:border-gatepass-800 dark:bg-gatepass-900">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2]/10">{icon}</div>
        <div>
          <p className={`text-2xl font-bold ${valueClass ?? "text-gatepass-900 dark:text-gatepass-100"}`}>{value}</p>
          <p className="text-xs text-gatepass-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
