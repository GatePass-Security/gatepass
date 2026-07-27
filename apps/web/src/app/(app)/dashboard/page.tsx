"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import type { ScanSummary, Finding } from "@/lib/types";
import { Loader2, Plus, TrendingUp, AlertTriangle, Shield, FileText, ShieldCheck, FlaskConical } from "lucide-react";

const MAX_BAR_HEIGHT = 160;

interface Overview {
  scans: ScanSummary[];
  latestFindings: Finding[];
  latestRepo?: string;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const SEVERITY_BAR: Record<string, string> = {
  critical: "#DC2626",
  high: "#F97316",
  medium: "#F59E0B",
  low: "#CBD5E1",
};
const RISK_BADGE: Record<string, string> = {
  critical: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
};

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function Home() {
  const [data, setData] = useState<Overview | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await api.getOrg(ORG_ID);
        const scans = await api.listScans(ORG_ID);
        const sorted = [...scans].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        const latest = sorted[0];
        const latestFindings = latest ? await api.getFindings(latest.id) : [];
        setData({ scans: sorted, latestFindings, latestRepo: latest?.repo });
        setReady(true);
      } catch {
        setReady(false);
      }
    })();
  }, []);

  if (ready === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gatepass-400" />
      </div>
    );
  }

  if (!ready) {
    return (
      <main className="px-6 py-10">
        <h1 className="text-2xl font-bold text-gatepass-900 dark:text-gatepass-100">Gatepass Dashboard</h1>
        <p className="mt-1 text-sm text-gatepass-500">Application security posture for the AI-native stack</p>
        <div className="mt-12 mx-auto max-w-lg rounded-lg border border-gatepass-200 bg-white p-12 text-center dark:border-gatepass-800 dark:bg-gatepass-900">
          <p className="text-sm text-gatepass-500">Could not reach the Gatepass API. Is it running on port 3000?</p>
        </div>
      </main>
    );
  }

  const scans = data?.scans ?? [];
  const totalScanned = scans.length;
  const totalVerified = scans.reduce((n, s) => n + s.verified, 0);
  const totalResearch = scans.reduce((n, s) => n + s.research, 0);
  const critical = scans.reduce((n, s) => n + (s.bySeverity.critical ?? 0), 0);

  // No scans yet — a real, honest empty state, not fabricated metrics.
  if (totalScanned === 0) {
    return (
      <main className="px-6 py-10">
        <h1 className="text-2xl font-bold text-gatepass-900 dark:text-gatepass-100">Gatepass Dashboard</h1>
        <p className="mt-1 text-sm text-gatepass-500">Application security posture for the AI-native stack</p>
        <div className="mt-12 mx-auto max-w-lg rounded-lg border border-gatepass-200 bg-white p-12 text-center dark:border-gatepass-800 dark:bg-gatepass-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gatepass-100 dark:bg-gatepass-800">
            <Shield size={32} className="text-gatepass-400" />
          </div>
          <h2 className="mt-6 text-xl font-semibold text-gatepass-900 dark:text-gatepass-100">No scans yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gatepass-500">
            Connect a repository or trigger a scan. Verified findings and posture will appear here.
          </p>
          <Link
            href="/fleet"
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-[#0D9488] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#0F766E]"
          >
            <Plus size={16} />
            Register a server
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gatepass-900 dark:text-gatepass-100">Gatepass Dashboard</h1>
        <p className="mt-1 text-sm text-gatepass-500">Application security posture for the AI-native stack</p>
      </div>

      {/* Row 1: finding tallies (all real, summed across scans) */}
      <div className="grid gap-4 sm:grid-cols-4">
        <MetricCard
          label="Verified findings"
          value={totalVerified}
          icon={<ShieldCheck size={18} className="text-emerald-500" />}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <MetricCard
          label="Research findings"
          value={totalResearch}
          icon={<FlaskConical size={18} className="text-blue-500" />}
          accent="text-blue-600 dark:text-blue-400"
        />
        <MetricCard label="Critical" value={critical} accent="text-red-600 dark:text-red-400" />
        <MetricCard label="Scans" value={totalScanned} accent="text-gatepass-700 dark:text-gatepass-200" />
      </div>

      {/* Row 2: per-scan severity chart (real counts, chronological) */}
      <div className="rounded-lg border border-gatepass-200 bg-white p-6 dark:border-gatepass-800 dark:bg-gatepass-900">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-gatepass-400" />
          <p className="text-sm font-medium text-gatepass-700 dark:text-gatepass-200">Findings by scan</p>
        </div>
        <SeverityChart scans={[...scans].reverse()} />
        <div className="mt-4 flex items-center gap-4 text-xs text-gatepass-500">
          {SEVERITY_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1.5 capitalize">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_BAR[s] }} />
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Row 3: real findings from the latest scan */}
      <div className="rounded-lg border border-gatepass-200 bg-white dark:border-gatepass-800 dark:bg-gatepass-900">
        <div className="flex items-center justify-between border-b border-gatepass-200 px-6 py-4 dark:border-gatepass-800">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-gatepass-400" />
            <h2 className="text-sm font-semibold text-gatepass-900 dark:text-gatepass-100">
              Latest findings{data?.latestRepo ? ` — ${data.latestRepo.split(/[\\/]/).pop()}` : ""}
            </h2>
          </div>
          <Link
            href="/findings"
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-[#0D9488] hover:bg-gatepass-50 dark:hover:bg-gatepass-800"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gatepass-50 dark:bg-gatepass-800/50">
                {["Vulnerability", "Path", "Tier", "Risk"].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gatepass-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data!.latestFindings.slice(0, 8).map((f) => {
                const loc = f.locations[0];
                return (
                  <tr
                    key={f.fingerprint}
                    className="border-b border-gatepass-100 last:border-b-0 hover:bg-gatepass-50/50 dark:border-gatepass-800 dark:hover:bg-gatepass-800/40"
                  >
                    <td className="px-6 py-3 font-medium text-gatepass-900 dark:text-gatepass-100">{f.classId}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gatepass-500">
                      {loc ? `${loc.path}:${loc.startLine}` : "—"}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${f.tier === "verified" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"}`}
                      >
                        {f.tier === "verified"
                          ? "verified"
                          : `research${typeof f.confidence === "number" ? ` ${Math.round(f.confidence * 100)}%` : ""}`}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${RISK_BADGE[f.severity] ?? RISK_BADGE.low}`}
                      >
                        {f.severity}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {data!.latestFindings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gatepass-500">
                    <AlertTriangle size={16} className="mx-auto mb-2 text-gatepass-400" />
                    No findings in the latest scan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-gatepass-200 bg-white p-6 dark:border-gatepass-800 dark:bg-gatepass-900">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gatepass-500">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-3xl font-bold ${accent}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function SeverityChart({ scans }: { scans: ScanSummary[] }) {
  // HTML bars (not stretched SVG) so a single scan renders a clean fixed-width column
  // and axis labels never distort. Each bar stacks severities to its real total.
  const totals = scans.map((s) => SEVERITY_ORDER.reduce((n, sev) => n + (s.bySeverity[sev] ?? 0), 0));
  const maxVal = Math.max(1, ...totals);
  const labelEvery = Math.ceil((scans.length || 1) / 8);

  return (
    <div className="mt-4 flex items-end gap-2 overflow-x-auto" style={{ height: MAX_BAR_HEIGHT + 28 }}>
      {scans.map((s, i) => {
        const total = totals[i]!;
        return (
          <div
            key={s.id}
            className="flex shrink-0 flex-col items-center"
            style={{ width: 34 }}
            title={`${total} finding${total === 1 ? "" : "s"}`}
          >
            <div className="flex w-full flex-col-reverse justify-start rounded-t-sm" style={{ height: MAX_BAR_HEIGHT }}>
              {SEVERITY_ORDER.slice()
                .reverse()
                .map((sev) => {
                  const count = s.bySeverity[sev] ?? 0;
                  if (count === 0) return null;
                  return (
                    <div
                      key={sev}
                      style={{ height: (count / maxVal) * MAX_BAR_HEIGHT, background: SEVERITY_BAR[sev] }}
                      className="w-full first:rounded-t-sm"
                    />
                  );
                })}
            </div>
            <span className="mt-2 h-4 truncate text-[9px] text-gatepass-400">
              {i % labelEvery === 0 ? relativeTime(s.createdAt) || `#${i + 1}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
