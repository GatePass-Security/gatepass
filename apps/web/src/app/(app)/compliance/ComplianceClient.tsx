"use client";

import { useState, useMemo } from "react";
import {
  FileCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  ChevronDown,
  ChevronRight,
  Search,
  ExternalLink,
  Code2,
  Eye,
  Shield,
  Globe,
  Smartphone,
  Apple,
  Monitor,
} from "lucide-react";
import type { ComplianceResult, ComplianceCheck, ComplianceDomain, ComplianceSeverity } from "@gatepass/compliance";

// ── Domain icons ──────────────────────────────────────────────────────
const domainIcon: Record<ComplianceDomain, React.ComponentType<{ size?: number; className?: string }>> = {
  wcag: Eye,
  ccpa: Shield,
  app_store: Apple,
  google_play: Monitor,
  eu_ai_act: Globe,
};

// ── Severity styling ──────────────────────────────────────────────────
const severityStyles: Record<
  ComplianceSeverity,
  { dot: string; badge: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  critical: { dot: "bg-red-500", badge: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  warning: { dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle },
  info: { dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700 border-blue-200", icon: Info },
};

// ── Props ─────────────────────────────────────────────────────────────
interface Props {
  result: ComplianceResult;
}

export default function ComplianceClient({ result }: Props) {
  const [expandedDomain, setExpandedDomain] = useState<ComplianceDomain | null>(null);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "pass" | "fail">("all");
  const [filterDomain, setFilterDomain] = useState<ComplianceDomain | "all">("all");

  const filteredChecks = useMemo(() => {
    return result.checks.filter((c) => {
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (filterDomain !== "all" && c.domain !== filterDomain) return false;
      return true;
    });
  }, [result.checks, filterStatus, filterDomain]);

  // byDomain is a Partial<Record<...>> (a domain with no rules is absent), so drop empty
  // entries here rather than guarding at every render site.
  const domainEntries = useMemo(() => {
    type DomainStats = { total: number; pass: number; fail: number; score: number };
    return (Object.entries(result.byDomain) as [ComplianceDomain, DomainStats | undefined][])
      .filter((entry): entry is [ComplianceDomain, DomainStats] => entry[1] !== undefined)
      .sort((a, b) => {
        const order: Record<string, number> = { wcag: 0, ccpa: 1, app_store: 2, google_play: 3, eu_ai_act: 4 };
        return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
      });
  }, [result.byDomain]);

  const statusCount = (status: ComplianceCheck["status"]) => result.checks.filter((c) => c.status === status).length;

  return (
    <div className="space-y-6">
      {/* ═══ Header ═══ */}
      <div>
        <h1 className="text-2xl font-bold text-gatepass-900 dark:text-white">Compliance Posture</h1>
        <p className="mt-1 text-sm text-gatepass-500">
          Automated compliance scanning against WCAG 2.2, CCPA/CPRA, Apple App Store, Google Play, and EU AI Act (2026).
        </p>
      </div>

      {/* ═══ Overall Score Card ═══ */}
      <div className="rounded-xl border border-gatepass-200 bg-white dark:bg-gatepass-800/50 dark:border-gatepass-700 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Score ring */}
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-gatepass-200 dark:text-gatepass-700"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 42}`}
                strokeDashoffset={`${2 * Math.PI * 42 * (1 - result.score / 100)}`}
                className={
                  result.score >= 80 ? "text-emerald-500" : result.score >= 50 ? "text-amber-500" : "text-red-500"
                }
              />
            </svg>
            <span
              className={`absolute text-2xl font-bold ${result.score >= 80 ? "text-emerald-600" : result.score >= 50 ? "text-amber-600" : "text-red-600"}`}
            >
              {result.score}
            </span>
          </div>

          {/* Score details */}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gatepass-900 dark:text-white">
              {result.score >= 90
                ? "Excellent compliance posture"
                : result.score >= 70
                  ? "Good compliance posture"
                  : result.score >= 50
                    ? "Moderate compliance posture"
                    : "Poor compliance posture — action needed"}
            </h2>
            <p className="mt-1 text-sm text-gatepass-500">
              {result.failCount === 0
                ? "All automated checks pass."
                : `${result.failCount} of ${result.totalChecks} checks require attention.`}
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <MetricBadge
                icon={CheckCircle}
                label="Passed"
                value={result.passCount}
                color="text-emerald-600"
                bg="bg-emerald-50"
              />
              <MetricBadge icon={XCircle} label="Failed" value={result.failCount} color="text-red-600" bg="bg-red-50" />
              <MetricBadge
                icon={Info}
                label="Manual Review"
                value={result.manualCount}
                color="text-blue-600"
                bg="bg-blue-50"
              />
              <MetricBadge
                icon={MinusIcon}
                label="N/A"
                value={result.naCount}
                color="text-gatepass-500"
                bg="bg-gatepass-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Domain Score Cards ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {domainEntries.map(([domain, stats]) => {
          const Icon = domainIcon[domain];
          const domainLabel = {
            wcag: "WCAG",
            ccpa: "CCPA",
            app_store: "App Store",
            google_play: "Play Store",
            eu_ai_act: "EU AI",
          }[domain];
          return (
            <button
              key={domain}
              onClick={() => setExpandedDomain(expandedDomain === domain ? null : domain)}
              className={`rounded-lg border p-4 text-left transition-all hover:shadow-sm ${
                expandedDomain === domain
                  ? "border-[#0D9488] ring-1 ring-[#0D9488]"
                  : "border-gatepass-200 dark:border-gatepass-700"
              } bg-white dark:bg-gatepass-800/50`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={16} className="text-gatepass-400" />
                <span className="text-xs font-medium text-gatepass-500 uppercase">{domainLabel}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className={`text-xl font-bold ${stats.score >= 80 ? "text-emerald-600" : stats.score >= 50 ? "text-amber-600" : "text-red-600"}`}
                >
                  {stats.score}
                </span>
                <span className="text-xs text-gatepass-400">/100</span>
              </div>
              <div className="mt-1 flex gap-2 text-[11px] text-gatepass-500">
                <span className="text-emerald-600">{stats.pass} pass</span>
                {stats.fail > 0 && <span className="text-red-600">{stats.fail} fail</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══ Filters ═══ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gatepass-500 mr-1">Filter:</span>
        {(["all", "fail", "pass"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterStatus === s
                ? "bg-[#0891b2] text-white"
                : "border border-gatepass-300 bg-white text-gatepass-600 hover:bg-gatepass-50"
            }`}
          >
            {s === "all" ? "All" : s === "fail" ? "Failing" : "Passing"}
          </button>
        ))}
        <span className="mx-1 text-gatepass-300">|</span>
        {(["all", "wcag", "ccpa", "app_store", "google_play", "eu_ai_act"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setFilterDomain(d)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterDomain === d
                ? "bg-gatepass-800 text-white dark:bg-gatepass-200 dark:text-gatepass-900"
                : "border border-gatepass-300 bg-white text-gatepass-600 hover:bg-gatepass-50"
            }`}
          >
            {d === "all"
              ? "All"
              : { wcag: "WCAG", ccpa: "CCPA", app_store: "App Store", google_play: "Play", eu_ai_act: "EU AI" }[d]}
          </button>
        ))}
      </div>

      {/* ═══ Checks List ═══ */}
      <div className="space-y-2">
        {filteredChecks.length === 0 && (
          <div className="rounded-lg border border-gatepass-200 bg-white dark:bg-gatepass-800/50 p-8 text-center">
            <FileCheck size={32} className="mx-auto text-gatepass-300" />
            <p className="mt-2 text-sm text-gatepass-500">No checks match the current filters.</p>
          </div>
        )}

        {filteredChecks.map((check) => {
          const SeverityIcon = severityStyles[check.severity].icon;
          const isExpanded = expandedRule === check.ruleId;

          return (
            <div
              key={check.ruleId}
              className={`rounded-lg border bg-white dark:bg-gatepass-800/50 overflow-hidden transition-all ${
                check.status === "fail"
                  ? "border-red-200 dark:border-red-900"
                  : check.status === "pass"
                    ? "border-emerald-200 dark:border-emerald-900"
                    : "border-gatepass-200 dark:border-gatepass-700"
              }`}
            >
              {/* Header row */}
              <button
                onClick={() => setExpandedRule(isExpanded ? null : check.ruleId)}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                {/* Status icon */}
                {check.status === "pass" ? (
                  <CheckCircle size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : check.status === "fail" ? (
                  <SeverityIcon size={18} className="mt-0.5 shrink-0 text-red-500" />
                ) : (
                  <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gatepass-900 dark:text-white">{check.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${severityStyles[check.severity].badge}`}
                    >
                      {check.severity}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-gatepass-100 text-gatepass-600 border border-gatepass-200">
                      {check.domain.toUpperCase()}
                    </span>
                    <span
                      className={`text-[10px] font-medium uppercase ${
                        check.status === "pass"
                          ? "text-emerald-600"
                          : check.status === "fail"
                            ? "text-red-600"
                            : "text-blue-600"
                      }`}
                    >
                      {check.status === "not_applicable"
                        ? "N/A"
                        : check.status === "manual_review"
                          ? "Manual Review"
                          : check.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gatepass-500 line-clamp-2">{check.description}</p>
                </div>

                <div className="shrink-0">
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-gatepass-400" />
                  ) : (
                    <ChevronRight size={16} className="text-gatepass-400" />
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-gatepass-200 dark:border-gatepass-700 px-4 py-4 space-y-4">
                  {/* Locations */}
                  {check.locations.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-gatepass-500 mb-2 uppercase">Locations</h4>
                      <div className="space-y-1">
                        {check.locations.map((loc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs font-mono text-gatepass-600 bg-gatepass-50 dark:bg-gatepass-800 rounded px-2 py-1"
                          >
                            <span>
                              {loc.path || "unknown"}
                              {loc.startLine ? `:${loc.startLine}` : ""}
                            </span>
                            {loc.snippet && (
                              <span className="text-gatepass-400 truncate max-w-[400px]">{loc.snippet}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fix suggestion */}
                  {check.fix && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Code2 size={14} className="text-blue-600" />
                        <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                          {check.fix.kind === "file_create"
                            ? "Create file"
                            : check.fix.kind === "config_change"
                              ? "Configuration change"
                              : check.fix.kind === "code_change"
                                ? "Code change"
                                : "Suggested fix"}
                        </h4>
                      </div>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mb-3">{check.fix.description}</p>

                      {/* Diff display */}
                      {check.fix.diff && (
                        <pre className="rounded bg-blue-100 dark:bg-blue-900/50 p-3 text-xs font-mono text-blue-800 dark:text-blue-200 overflow-x-auto whitespace-pre-wrap">
                          {check.fix.diff}
                        </pre>
                      )}

                      {/* New file content */}
                      {check.fix.newContent && (
                        <div>
                          <p className="text-xs text-blue-600 mb-1">
                            New file: <code className="font-mono">{check.fix.filePath || "unknown"}</code>
                          </p>
                          <pre className="rounded bg-blue-100 dark:bg-blue-900/50 p-3 text-xs font-mono text-blue-800 dark:text-blue-200 overflow-x-auto max-h-48 overflow-y-auto">
                            {check.fix.newContent.length > 800
                              ? check.fix.newContent.slice(0, 800) + "\n/* ... truncated */"
                              : check.fix.newContent}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* No fix for passes */}
                  {check.status === "pass" && (
                    <div className="flex items-center gap-2 text-xs text-emerald-600">
                      <CheckCircle size={12} />
                      <span>This check passes automatically.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────────

function MetricBadge({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${bg}`}>
      <Icon size={12} className={color} />
      <span className="text-xs font-medium text-gatepass-700">
        <strong>{value}</strong> {label}
      </span>
    </div>
  );
}

function MinusIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size ?? 16}
      height={size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
