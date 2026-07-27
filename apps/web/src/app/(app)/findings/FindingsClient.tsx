"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Finding } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Search, AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, FlaskConical, Circle } from "lucide-react";
import { confidencePercent } from "@/lib/utils";

interface Props {
  findings: Finding[];
  scanId?: string;
  error: string | null;
}

type TierFilter = "all" | "verified" | "research";
type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

const severityDotColor: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-500",
  low: "bg-gray-400",
};

const severityIconColor = {
  critical: { ring: "bg-red-100", fill: "text-red-500" },
  high: { ring: "bg-orange-100", fill: "text-orange-500" },
  medium: { ring: "bg-amber-100", fill: "text-amber-500" },
  low: { ring: "bg-blue-100", fill: "text-blue-500" },
} as const;

const severityPillActive: Record<string, string> = {
  critical: "border border-red-200 bg-red-50 text-red-700",
  high: "border border-orange-200 bg-orange-50 text-orange-700",
  medium: "border border-blue-200 bg-blue-50 text-blue-700",
  low: "border border-gray-200 bg-gray-50 text-gray-700",
};

const severityPillInactive = "border border-gatepass-300 bg-white text-gatepass-600";

export default function FindingsClient({ findings, scanId, error }: Props) {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").toLowerCase();
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [expandedFingerprint, setExpandedFingerprint] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeModal, setDisputeModal] = useState<string | null>(null);

  const totalCount = findings.length;
  const verifiedCount = findings.filter((f) => f.tier === "verified").length;
  const researchCount = findings.filter((f) => f.tier === "research").length;

  const filtered = findings.filter((f) => {
    if (tierFilter !== "all" && f.tier !== tierFilter) return false;
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    if (query) {
      const hay =
        `${f.classId} ${f.severity} ${f.tier} ${f.explanation ?? ""} ${f.locations.map((l) => l.path).join(" ")}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  async function handleDispute(fingerprint: string) {
    setDisputing(fingerprint);
    try {
      const { api } = await import("@/lib/api-client");
      if (scanId) {
        await api.disputeFinding(fingerprint, scanId, disputeReason || "Disputed");
        setDisputeModal(null);
        setDisputeReason("");
      }
    } catch (e) {
      console.error("Dispute failed", e);
    } finally {
      setDisputing(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <EmptyState
        icon={<Search size={48} />}
        title="No findings yet"
        description="Run a scan on a repository to see security findings here"
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gatepass-900">Findings Intelligence</h1>
          <p className="mt-0.5 text-sm text-gatepass-500">
            Real-time analysis of security anomalies across your repositories.
          </p>
        </div>
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gatepass-100">
              <Search size={20} className="text-gatepass-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gatepass-900">{totalCount}</p>
              <p className="text-xs text-gatepass-500">Total Findings</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <ShieldCheck size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gatepass-900">{verifiedCount}</p>
              <p className="text-xs text-gatepass-500">Verified</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gatepass-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100">
              <FlaskConical size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gatepass-900">{researchCount}</p>
              <p className="text-xs text-gatepass-500">Research</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <span className="text-sm text-gatepass-500 mr-2 shrink-0">Filter by:</span>

        {/* Tier filter buttons */}
        <div className="flex overflow-hidden rounded-lg w-full sm:w-auto">
          {(["all", "verified", "research"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm font-medium transition-colors ${
                tierFilter === t
                  ? "bg-[#0891b2] text-white"
                  : "border border-gatepass-300 bg-white text-gatepass-600 hover:bg-gatepass-50"
              }`}
            >
              {t === "all" ? "All" : t === "verified" ? "Verified" : "Research"}
            </button>
          ))}
        </div>

        {/* Severity pill filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(severityFilter === s ? "all" : s)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                severityFilter === s ? severityPillActive[s] : severityPillInactive
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${severityDotColor[s]}`} />
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Findings list */}
      <div className="space-y-3">
        {filtered.map((finding) => {
          const sev = severityIconColor[finding.severity] ?? severityIconColor.low;
          return (
            <Card key={finding.fingerprint} padding={false}>
              <div className="p-3 sm:p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 sm:gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Severity-colored circle icon */}
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${sev.ring}`}>
                      <Circle size={16} className={sev.fill} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gatepass-900">{finding.classId}</span>
                        {/* Severity badge */}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${severityPillActive[finding.severity]}`}
                        >
                          {finding.severity}
                        </span>
                        {/* Tier label */}
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-gatepass-600 bg-gatepass-100">
                          {finding.tier}
                          {finding.tier === "research" &&
                            finding.confidence !== undefined &&
                            ` · ${confidencePercent(finding.confidence)}`}
                        </span>
                      </div>

                      {/* Confidence bar for research */}
                      {finding.tier === "research" && finding.confidence !== undefined && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gatepass-200">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${finding.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-gatepass-500">{confidencePercent(finding.confidence)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setDisputeModal(finding.fingerprint)}
                      className="rounded px-3 py-1.5 text-xs font-medium text-gatepass-500 hover:bg-gatepass-100 hover:text-gatepass-700 transition-colors"
                    >
                      Dispute
                    </button>
                    <button
                      onClick={() =>
                        setExpandedFingerprint(expandedFingerprint === finding.fingerprint ? null : finding.fingerprint)
                      }
                      className="rounded p-1.5 text-gatepass-400 hover:bg-gatepass-100 transition-colors"
                    >
                      {expandedFingerprint === finding.fingerprint ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {expandedFingerprint === finding.fingerprint && (
                  <div className="mt-4 border-t border-gatepass-200 pt-4">
                    <p className="text-sm text-gatepass-600">{finding.explanation}</p>

                    {/* Locations */}
                    {finding.locations.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-medium uppercase text-gatepass-500 mb-2">Locations</h4>
                        <div className="space-y-1">
                          {finding.locations.map((loc, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-gatepass-600">
                              <span className="font-mono">
                                {loc.path}:{loc.startLine}-{loc.endLine}
                              </span>
                              <span className="rounded bg-gatepass-100 px-1.5 py-0.5 text-[10px]">{loc.surface}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Surfaces */}
                    <div className="mt-3">
                      <h4 className="text-xs font-medium uppercase text-gatepass-500 mb-2">Surfaces Affected</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {finding.surfaces.map((s) => (
                          <span key={s} className="rounded bg-gatepass-100 px-2 py-0.5 text-xs text-gatepass-600">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Reproduction (verified only) */}
                    {finding.tier === "verified" && finding.reproduction && (
                      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <ShieldCheck size={14} className="text-emerald-600" />
                          <h4 className="text-sm font-medium text-emerald-800">Reproduction Steps</h4>
                        </div>
                        <p className="mb-2 text-xs text-emerald-700">Kind: {finding.reproduction.kind}</p>
                        <ol className="list-inside list-decimal space-y-1 text-sm text-emerald-700">
                          {finding.reproduction.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                        <div className="mt-3 rounded bg-emerald-100 p-3 text-sm">
                          <span className="font-medium text-emerald-800">Expected: </span>
                          <span className="text-emerald-700">{finding.reproduction.expected}</span>
                        </div>
                      </div>
                    )}

                    {/* Suggested fix */}
                    {finding.suggestedFix && (
                      <div className="mt-3">
                        <h4 className="text-xs font-medium uppercase text-gatepass-500 mb-2">Suggested Fix</h4>
                        <pre className="rounded-lg bg-gatepass-100 p-3 text-xs text-gatepass-700 overflow-x-auto">
                          {finding.suggestedFix.content}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dispute modal */}
              {disputeModal === finding.fingerprint && (
                <div className="border-t border-gatepass-200 p-4">
                  <label className="block text-sm font-medium text-gatepass-700">Reason for dispute</label>
                  <textarea
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    className="mt-2 block w-full rounded-lg border border-gatepass-300 bg-white px-4 py-2 text-sm text-gatepass-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={3}
                    placeholder="Explain why this finding should be suppressed..."
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={() => handleDispute(finding.fingerprint)}
                      disabled={disputing === finding.fingerprint || !disputeReason}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                    >
                      {disputing === finding.fingerprint ? "Submitting..." : "Submit dispute"}
                    </button>
                    <button
                      onClick={() => {
                        setDisputeModal(null);
                        setDisputeReason("");
                      }}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-gatepass-500 hover:bg-gatepass-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
