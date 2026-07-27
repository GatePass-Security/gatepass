"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";
import type {
  ScanSummary,
  Finding,
  FleetView,
  RepoRecord,
  BenchmarkData,
  OrgRecord,
} from "@/lib/types";
import {
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Search,
  Server,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  FlaskConical,
  BarChart3,
  FileCheck,
  Clock,
  Play,
  Download,
  Lightbulb,
  Settings,
  FolderGit2,
  CheckCircle2,
  XCircle,
  Link2,
  FileText,
  Copy,
} from "lucide-react";

/* ─── helpers ────────────────────────────────────────────────────────── */

function detectedCount(run: BenchmarkData["runs"][number]) {
  return run.perClass.filter((pc) => pc.tp > 0).length;
}
function meanPrecision(run: BenchmarkData["runs"][number]) {
  const scored = run.perClass.filter((pc) => pc.tp + pc.fp > 0);
  if (scored.length === 0) return null;
  return scored.reduce((s, pc) => s + pc.tp / (pc.tp + pc.fp), 0) / scored.length;
}
function meanRecall(run: BenchmarkData["runs"][number]) {
  if (run.perClass.length === 0) return 0;
  return run.perClass.reduce((s, pc) => s + pc.recall, 0) / run.perClass.length;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-gatepass-50 text-gatepass-600 border-gatepass-200",
};

/* ─── state shape ────────────────────────────────────────────────────── */

interface DashboardData {
  org: OrgRecord | null;
  scans: ScanSummary[];
  latestFindings: Finding[];
  latestRepo?: string;
  latestScanId?: string;
  fleet: FleetView | null;
  repos: RepoRecord[];
  benchmark: BenchmarkData | null;
}

/* ─── page ───────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const org = await api.getOrg(ORG_ID);
      const scans = await api.listScans(ORG_ID);
      const sorted = [...scans].sort(
        (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
      );
      const latest = sorted[0];
      const latestFindings = latest ? await api.getFindings(latest.id) : [];

      let fleet: FleetView | null = null;
      try { fleet = await api.getFleet(ORG_ID); } catch { /* optional */ }

      let repos: RepoRecord[] = [];
      try { repos = await api.getRepos(ORG_ID); } catch { /* optional */ }

      let benchmark: BenchmarkData | null = null;
      try {
        const b = await api.getBenchmark();
        benchmark = Array.isArray(b) ? b[0] ?? null : b;
      } catch { /* optional */ }

      setData({
        org,
        scans: sorted,
        latestFindings,
        latestRepo: latest?.repo,
        latestScanId: latest?.id,
        fleet,
        repos,
        benchmark,
      });
      setReady(true);
    } catch {
      setReady(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  async function handleTriggerScan() {
    if (!scanTarget.trim()) return;
    setScanning(true);
    try {
      await api.triggerScan(ORG_ID, scanTarget.trim());
      setScanTarget("");
      await loadData();
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setScanning(false);
    }
  }

  async function handleDownloadSarif() {
    if (!data?.latestScanId) return;
    try {
      const sarif = await api.getSarif(data.latestScanId);
      const blob = new Blob([JSON.stringify(sarif, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `findings-${data.latestScanId.slice(0, 8)}.sarif.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("SARIF download failed", e);
    }
  }

  async function handleConnectIntegration(platform: "vanta" | "drata") {
    try {
      await api.connectIntegration(ORG_ID, platform);
      setCopied(platform);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      console.error("Integration connect failed", e);
    }
  }

  function copyFingerprint(fp: string) {
    navigator.clipboard.writeText(fp);
    setCopied(fp);
    setTimeout(() => setCopied(null), 1500);
  }

  /* Loading */
  if (ready === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-[#0D9488]" />
          <span className="text-sm text-gatepass-500">Loading dashboard…</span>
        </div>
      </div>
    );
  }

  /* Error */
  if (!ready) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gatepass-900">Dashboard</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-red-700">
            Could not reach the Gatepass API. Is the backend running on port 3000?
          </p>
        </div>
      </div>
    );
  }

  /* Data */
  const scans = data?.scans ?? [];
  const totalScans = scans.length;
  const totalVerified = scans.reduce((n, s) => n + s.verified, 0);
  const totalResearch = scans.reduce((n, s) => n + s.research, 0);
  const criticalCount = scans.reduce((n, s) => n + (s.bySeverity.critical ?? 0), 0);
  const highCount = scans.reduce((n, s) => n + (s.bySeverity.high ?? 0), 0);
  const latestFindings = data?.latestFindings ?? [];
  const fleet = data?.fleet;
  const repos = data?.repos ?? [];
  const benchmark = data?.benchmark;
  const org = data?.org;

  const benchmarkPrimary = benchmark?.runs.find((r) =>
    r.tool.toLowerCase().startsWith("gatepass")
  ) ?? benchmark?.runs[0];

  return (
    <div className="space-y-6">
      {/* ═══════════ HEADER ═══════════ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gatepass-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gatepass-500">
            Centralized security posture for your organization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 bg-white px-3.5 py-2 text-sm font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ═══════════ 1. TRIGGER SCAN ═══════════ */}
      <div className="rounded-lg border border-gatepass-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Play size={16} className="text-[#0D9488]" />
          <h3 className="text-sm font-semibold text-gatepass-900">Run a Scan</h3>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={scanTarget}
            onChange={(e) => setScanTarget(e.target.value)}
            placeholder="Enter repository path (e.g. /path/to/repo)"
            className="flex-1 rounded-lg border border-gatepass-200 bg-gatepass-50 px-4 py-2 text-sm text-gatepass-900 placeholder:text-gatepass-400 focus:border-[#0D9488] focus:outline-none focus:ring-1 focus:ring-[#0D9488]"
            onKeyDown={(e) => e.key === "Enter" && handleTriggerScan()}
          />
          <button
            type="button"
            onClick={handleTriggerScan}
            disabled={scanning || !scanTarget.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0D9488] px-4 py-2 text-sm font-medium text-white hover:bg-[#0F766E] transition-colors disabled:opacity-50"
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>
      </div>

      {/* ═══════════ 2. METRIC CARDS ═══════════ */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total Scans"
          value={totalScans}
          icon={<BarChart3 size={16} className="text-gatepass-400" />}
          sub={
            scans[0]?.createdAt
              ? `Latest: ${new Date(scans[0].createdAt).toLocaleDateString()}`
              : "—"
          }
          subIcon={<Clock size={12} />}
        />
        <MetricCard
          label="Verified Findings"
          value={totalVerified}
          icon={<ShieldCheck size={16} className="text-emerald-500" />}
          sub="Deterministic, 0% false-positive"
        />
        <MetricCard
          label="Research Findings"
          value={totalResearch}
          icon={<FlaskConical size={16} className="text-blue-500" />}
          sub="Confidence-scored, LLM-assisted"
        />
        <MetricCard
          label="Critical / High"
          value={`${criticalCount} / ${highCount}`}
          icon={<AlertTriangle size={16} className="text-red-500" />}
          sub={criticalCount === 0 ? "No critical issues" : "Requires attention"}
        />
      </div>

      {/* ═══════════ 3. FLEET STATUS ═══════════ */}
      {fleet && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server size={16} className="text-gatepass-400" />
              <h3 className="text-sm font-semibold text-gatepass-900">Fleet Status</h3>
              <span className="text-xs text-gatepass-400">
                {fleet.servers.length} server{fleet.servers.length !== 1 ? "s" : ""} registered
              </span>
            </div>
            <Link
              href="/fleet"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline"
            >
              Manage fleet <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md bg-gatepass-50 px-3 py-2">
              <p className="text-xs text-gatepass-500">Total</p>
              <p className="text-lg font-bold text-gatepass-900">{fleet.rollup.total}</p>
            </div>
            <div className="rounded-md bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-600">Passing</p>
              <p className="text-lg font-bold text-emerald-700">{fleet.rollup.passing}</p>
            </div>
            <div className="rounded-md bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-600">Open Findings</p>
              <p className="text-lg font-bold text-amber-700">{fleet.rollup.findings_open}</p>
            </div>
            <div className="rounded-md bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">Critical</p>
              <p className="text-lg font-bold text-red-700">{fleet.rollup.critical}</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ 4. COMPLIANCE + BENCHMARK ROW ═══════════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Compliance Summary */}
        <Link
          href="/compliance"
          className="group rounded-lg border border-gatepass-200 bg-white p-5 hover:border-[#0D9488]/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-2 mb-3">
            <FileCheck size={16} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-gatepass-900">Compliance Posture</h3>
          </div>
          <p className="text-xs text-gatepass-500 mb-3">
            WCAG 2.2 · CCPA/CPRA · Apple App Store · Google Play · EU AI Act
          </p>
          <div className="flex items-center gap-2 text-xs text-[#0D9488] font-medium">
            View full compliance dashboard <ArrowRight size={12} />
          </div>
        </Link>

        {/* Benchmark Summary */}
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-purple-500" />
              <h3 className="text-sm font-semibold text-gatepass-900">Precision Benchmark</h3>
            </div>
            <Link
              href="/benchmark"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline"
            >
              Full report <ArrowRight size={12} />
            </Link>
          </div>
          {benchmarkPrimary ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-gatepass-50 px-3 py-2 text-center">
                <p className="text-xs text-gatepass-500">Classes</p>
                <p className="text-lg font-bold text-gatepass-900">
                  {detectedCount(benchmarkPrimary)}/{benchmarkPrimary.perClass.length}
                </p>
              </div>
              <div className="rounded-md bg-gatepass-50 px-3 py-2 text-center">
                <p className="text-xs text-gatepass-500">Precision</p>
                <p className="text-lg font-bold text-emerald-600">
                  {(() => {
                    const p = meanPrecision(benchmarkPrimary);
                    return p === null ? "—" : `${(p * 100).toFixed(0)}%`;
                  })()}
                </p>
              </div>
              <div className="rounded-md bg-gatepass-50 px-3 py-2 text-center">
                <p className="text-xs text-gatepass-500">Recall</p>
                <p className="text-lg font-bold text-gatepass-900">
                  {(meanRecall(benchmarkPrimary) * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gatepass-400">No benchmark data available.</p>
          )}
        </div>
      </div>

      {/* ═══════════ 5. EXPORTS & INTEGRATIONS ═══════════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Export Actions */}
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <Download size={16} className="text-gatepass-400" />
            <h3 className="text-sm font-semibold text-gatepass-900">Export & Evidence</h3>
          </div>
          <p className="text-xs text-gatepass-500 mb-4">
            Download findings in standard formats for auditors, CI gates, or compliance tools.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownloadSarif}
              disabled={!data?.latestScanId}
              className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 px-3 py-2 text-xs font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors disabled:opacity-40"
            >
              <FileText size={14} />
              Download SARIF
            </button>
            <Link
              href="/findings"
              className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 px-3 py-2 text-xs font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
            >
              <Search size={14} />
              Browse Findings
            </Link>
            <Link
              href="/agent-guidance"
              className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 px-3 py-2 text-xs font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
            >
              <Lightbulb size={14} />
              Agent Guidance
            </Link>
          </div>
        </div>

        {/* Integrations */}
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <Link2 size={16} className="text-gatepass-400" />
            <h3 className="text-sm font-semibold text-gatepass-900">Integrations</h3>
          </div>
          <p className="text-xs text-gatepass-500 mb-4">
            Sync findings and compliance evidence with your GRC platform.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleConnectIntegration("vanta")}
              className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 px-3 py-2 text-xs font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
            >
              {copied === "vanta" ? (
                <CheckCircle2 size={14} className="text-emerald-500" />
              ) : (
                <Link2 size={14} />
              )}
              {copied === "vanta" ? "Connected" : "Connect Vanta"}
            </button>
            <button
              type="button"
              onClick={() => handleConnectIntegration("drata")}
              className="inline-flex items-center gap-2 rounded-lg border border-gatepass-200 px-3 py-2 text-xs font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
            >
              {copied === "drata" ? (
                <CheckCircle2 size={14} className="text-emerald-500" />
              ) : (
                <Link2 size={14} />
              )}
              {copied === "drata" ? "Connected" : "Connect Drata"}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ 6. REPO CONFIGURATION ═══════════ */}
      {repos.length > 0 && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FolderGit2 size={16} className="text-gatepass-400" />
              <h3 className="text-sm font-semibold text-gatepass-900">
                Repositories ({repos.length})
              </h3>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline"
            >
              Settings <ArrowRight size={12} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gatepass-100 text-xs font-medium uppercase tracking-wider text-gatepass-400">
                  <th className="pb-2 text-left">Repository</th>
                  <th className="pb-2 text-left">Status</th>
                  <th className="pb-2 text-left">Gate Mode</th>
                  <th className="pb-2 text-left">Frameworks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gatepass-100">
                {repos.map((repo) => (
                  <tr key={repo.name} className="hover:bg-gatepass-50 transition-colors">
                    <td className="py-2.5 font-medium text-gatepass-900">{repo.name}</td>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          repo.scanStatus === "complete"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : repo.scanStatus === "scanning"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : repo.scanStatus === "failed"
                                ? "border-red-200 bg-red-50 text-red-700"
                                : "border-gatepass-200 bg-gatepass-50 text-gatepass-600"
                        }`}
                      >
                        {repo.scanStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2.5 text-xs text-gatepass-500 font-mono">
                      {repo.gateMode.replace("_", " ")}
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(repo.frameworks ?? []).map((fw) => (
                          <span
                            key={fw}
                            className="rounded bg-gatepass-100 px-1.5 py-0.5 text-[10px] text-gatepass-600"
                          >
                            {fw}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════ 7. LATEST FINDINGS TABLE ═══════════ */}
      <div className="rounded-lg border border-gatepass-200 bg-white p-5">
        <div className="flex items-center justify-between border-b border-gatepass-100 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-gatepass-900">
              Latest Findings
              {data?.latestRepo && (
                <span className="ml-2 font-mono text-xs font-normal text-gatepass-400">
                  ({data.latestRepo})
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-gatepass-500">
              Verified findings carry runnable PoC reproductions. Copy a fingerprint to use with Agent Guidance.
            </p>
          </div>
          <Link
            href="/findings"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline"
          >
            All findings <ArrowRight size={12} />
          </Link>
        </div>

        {latestFindings.length === 0 ? (
          <div className="py-10 text-center text-sm text-gatepass-400">
            No findings in the latest scan. Your stack is clean.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gatepass-100 text-xs font-medium uppercase tracking-wider text-gatepass-400">
                  <th className="pb-2.5">Class</th>
                  <th className="pb-2.5">Location</th>
                  <th className="pb-2.5">Tier</th>
                  <th className="pb-2.5">Severity</th>
                  <th className="pb-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gatepass-100">
                {latestFindings.map((f) => (
                  <tr key={f.fingerprint} className="hover:bg-gatepass-50 transition-colors">
                    <td className="py-3 font-medium text-gatepass-900">
                      <div className="flex items-center gap-2">
                        {f.tier === "verified" ? (
                          <ShieldCheck size={14} className="text-emerald-500" />
                        ) : (
                          <FlaskConical size={14} className="text-blue-500" />
                        )}
                        {f.classId}
                      </div>
                    </td>
                    <td className="py-3 font-mono text-xs text-gatepass-500">
                      {f.locations[0]?.path}:{f.locations[0]?.startLine}
                    </td>
                    <td className="py-3">
                      {f.tier === "verified" ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          research{" "}
                          {f.confidence ? `${Math.round(f.confidence * 100)}%` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase ${
                          SEVERITY_STYLES[f.severity] ?? ""
                        }`}
                      >
                        {f.severity}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => copyFingerprint(f.fingerprint)}
                          className="inline-flex items-center gap-1 text-xs text-gatepass-400 hover:text-gatepass-700 transition-colors"
                          title="Copy fingerprint for Agent Guidance"
                        >
                          {copied === f.fingerprint ? (
                            <CheckCircle2 size={12} className="text-emerald-500" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                        <Link
                          href={`/findings?id=${f.fingerprint}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline"
                        >
                          View <ExternalLink size={11} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════ 8. RECENT SCANS ═══════════ */}
      {scans.length > 0 && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gatepass-900 mb-3">Recent Scans</h3>
          <div className="space-y-2">
            {scans.slice(0, 5).map((scan) => (
              <div
                key={scan.id}
                className="flex items-center justify-between rounded-md bg-gatepass-50 px-4 py-2.5 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-gatepass-400">
                    {scan.id.slice(0, 8)}
                  </span>
                  {scan.repo && <span className="text-gatepass-700">{scan.repo}</span>}
                </div>
                <div className="flex items-center gap-4 text-xs text-gatepass-500">
                  <span>
                    {scan.verified} verified · {scan.research} research
                  </span>
                  {scan.createdAt && (
                    <span className="text-gatepass-400">
                      {new Date(scan.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════ 9. ORG SETTINGS OVERVIEW ═══════════ */}
      {org && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-gatepass-400" />
              <h3 className="text-sm font-semibold text-gatepass-900">Organization</h3>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline"
            >
              Configure <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gatepass-500">Org ID</p>
              <p className="text-sm font-medium text-gatepass-900 font-mono">{org.id}</p>
            </div>
            <div>
              <p className="text-xs text-gatepass-500">Plan</p>
              <p className="text-sm font-medium text-gatepass-900 capitalize">{org.planTier}</p>
            </div>
            <div>
              <p className="text-xs text-gatepass-500">LLM Analysis</p>
              <p className="text-sm font-medium text-gatepass-900">
                {org.llmEnabled ? (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 size={13} /> Enabled
                  </span>
                ) : (
                  <span className="text-gatepass-400 flex items-center gap-1">
                    <XCircle size={13} /> Disabled
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gatepass-500">Agent Loop</p>
              <p className="text-sm font-medium text-gatepass-900">
                {org.agentLoopEnabled ? (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 size={13} /> Enabled
                  </span>
                ) : (
                  <span className="text-gatepass-400 flex items-center gap-1">
                    <XCircle size={13} /> Disabled
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── shared components ──────────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  icon,
  sub,
  subIcon,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  sub: string;
  subIcon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gatepass-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gatepass-500">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-3xl font-bold text-gatepass-900">{value}</p>
      <div className="mt-2 flex items-center gap-1 text-xs text-gatepass-500">
        {subIcon}
        <span>{sub}</span>
      </div>
    </div>
  );
}
