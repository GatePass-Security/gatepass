"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Shield, DollarSign, Clock, RefreshCw } from "lucide-react";

interface ScannerData {
  id: string;
  name: string;
  badge: string;
  detectedCount: number;
  totalCount: number;
  falsePositives: string;
  speed: string;
  cost: string;
  deterministic: boolean;
  statusColor: string;
  classes: { name: string; asi: string; status: "detected" | "missed" | "fp" }[];
}

const SCANNERS: ScannerData[] = [
  {
    id: "gatepass",
    name: "Gatepass Security Engine",
    badge: "Deterministic AST Engine",
    detectedCount: 12,
    totalCount: 12,
    falsePositives: "0.0%",
    speed: "0.9 ms",
    cost: "$0.00 (0 Tokens)",
    deterministic: true,
    statusColor: "#2DD4BF",
    classes: [
      { name: "Tool Poisoning", asi: "ASI01", status: "detected" },
      { name: "Unauthenticated MCP Transport", asi: "ASI02", status: "detected" },
      { name: "Confused Deputy Credential", asi: "ASI03", status: "detected" },
      { name: "Cross-Surface Scope Mismatch", asi: "ASI03", status: "detected" },
      { name: "Over-Permissioned Loop", asi: "ASI08", status: "detected" },
      { name: "Row-Level Security Gap", asi: "ASI03", status: "detected" },
      { name: "Exposed Provider Credential", asi: "ASI04", status: "detected" },
      { name: "Hallucination Scope Ambiguity", asi: "ASI01", status: "detected" },
      { name: "Missing Schema Validation", asi: "ASI02", status: "detected" },
      { name: "Unbounded Tool Parameter", asi: "ASI02", status: "detected" },
      { name: "CORS Wildcard Misconfig", asi: "AppSec", status: "detected" },
      { name: "Unpinned Dependency Range", asi: "ASI04", status: "detected" },
    ],
  },
  {
    id: "claude",
    name: "Claude Opus 5 (Blind Agent)",
    badge: "Non-Deterministic LLM",
    detectedCount: 12,
    totalCount: 12,
    falsePositives: "8.3% (Flagged Clean Code)",
    speed: "75,000 ms",
    cost: "~$0.42 (110k Tokens)",
    deterministic: false,
    statusColor: "#F59E0B",
    classes: [
      { name: "Tool Poisoning", asi: "ASI01", status: "detected" },
      { name: "Unauthenticated MCP Transport", asi: "ASI02", status: "detected" },
      { name: "Confused Deputy Credential", asi: "ASI03", status: "detected" },
      { name: "Cross-Surface Scope Mismatch", asi: "ASI03", status: "detected" },
      { name: "Over-Permissioned Loop", asi: "ASI08", status: "fp" },
      { name: "Row-Level Security Gap", asi: "ASI03", status: "detected" },
      { name: "Exposed Provider Credential", asi: "ASI04", status: "detected" },
      { name: "Hallucination Scope Ambiguity", asi: "ASI01", status: "detected" },
      { name: "Missing Schema Validation", asi: "ASI02", status: "detected" },
      { name: "Unbounded Tool Parameter", asi: "ASI02", status: "detected" },
      { name: "CORS Wildcard Misconfig", asi: "AppSec", status: "detected" },
      { name: "Unpinned Dependency Range", asi: "ASI04", status: "detected" },
    ],
  },
  {
    id: "coderabbit",
    name: "CodeRabbit AI",
    badge: "LLM Code Reviewer",
    detectedCount: 2,
    totalCount: 12,
    falsePositives: "High (LLM Hallucinations)",
    speed: "60,000 ms",
    cost: "High Token Costs / Mo",
    deterministic: false,
    statusColor: "#F97316",
    classes: [
      { name: "Tool Poisoning", asi: "ASI01", status: "missed" },
      { name: "Unauthenticated MCP Transport", asi: "ASI02", status: "missed" },
      { name: "Confused Deputy Credential", asi: "ASI03", status: "missed" },
      { name: "Cross-Surface Scope Mismatch", asi: "ASI03", status: "missed" },
      { name: "Over-Permissioned Loop", asi: "ASI08", status: "missed" },
      { name: "Row-Level Security Gap", asi: "ASI03", status: "missed" },
      { name: "Exposed Provider Credential", asi: "ASI04", status: "detected" },
      { name: "Hallucination Scope Ambiguity", asi: "ASI01", status: "missed" },
      { name: "Missing Schema Validation", asi: "ASI02", status: "missed" },
      { name: "Unbounded Tool Parameter", asi: "ASI02", status: "missed" },
      { name: "CORS Wildcard Misconfig", asi: "AppSec", status: "detected" },
      { name: "Unpinned Dependency Range", asi: "ASI04", status: "missed" },
    ],
  },
  {
    id: "ghas",
    name: "GitHub Advanced Security (CodeQL)",
    badge: "Enterprise CodeQL v2.26.1",
    detectedCount: 0,
    totalCount: 12,
    falsePositives: "0.0%",
    speed: "18,000 ms",
    cost: "Enterprise License",
    deterministic: true,
    statusColor: "#3B82F6",
    classes: [
      { name: "Tool Poisoning", asi: "ASI01", status: "missed" },
      { name: "Unauthenticated MCP Transport", asi: "ASI02", status: "missed" },
      { name: "Confused Deputy Credential", asi: "ASI03", status: "missed" },
      { name: "Cross-Surface Scope Mismatch", asi: "ASI03", status: "missed" },
      { name: "Over-Permissioned Loop", asi: "ASI08", status: "missed" },
      { name: "Row-Level Security Gap", asi: "ASI03", status: "missed" },
      { name: "Exposed Provider Credential", asi: "ASI04", status: "missed" },
      { name: "Hallucination Scope Ambiguity", asi: "ASI01", status: "missed" },
      { name: "Missing Schema Validation", asi: "ASI02", status: "missed" },
      { name: "Unbounded Tool Parameter", asi: "ASI02", status: "missed" },
      { name: "CORS Wildcard Misconfig", asi: "AppSec", status: "missed" },
      { name: "Unpinned Dependency Range", asi: "ASI04", status: "missed" },
    ],
  },
  {
    id: "semgrep",
    name: "Semgrep OSS",
    badge: "Static Pattern Scanner",
    detectedCount: 1,
    totalCount: 12,
    falsePositives: "0.0%",
    speed: "1,200 ms",
    cost: "$0.00",
    deterministic: true,
    statusColor: "#EF4444",
    classes: [
      { name: "Tool Poisoning", asi: "ASI01", status: "missed" },
      { name: "Unauthenticated MCP Transport", asi: "ASI02", status: "missed" },
      { name: "Confused Deputy Credential", asi: "ASI03", status: "missed" },
      { name: "Cross-Surface Scope Mismatch", asi: "ASI03", status: "missed" },
      { name: "Over-Permissioned Loop", asi: "ASI08", status: "missed" },
      { name: "Row-Level Security Gap", asi: "ASI03", status: "missed" },
      { name: "Exposed Provider Credential", asi: "ASI04", status: "detected" },
      { name: "Hallucination Scope Ambiguity", asi: "ASI01", status: "missed" },
      { name: "Missing Schema Validation", asi: "ASI02", status: "missed" },
      { name: "Unbounded Tool Parameter", asi: "ASI02", status: "missed" },
      { name: "CORS Wildcard Misconfig", asi: "AppSec", status: "missed" },
      { name: "Unpinned Dependency Range", asi: "ASI04", status: "missed" },
    ],
  },
];

export function BenchmarkVisualCard() {
  const [selectedScannerId, setSelectedScannerId] = useState<string>("gatepass");
  const scanner = SCANNERS.find((s) => s.id === selectedScannerId) ?? SCANNERS[0]!;

  return (
    <div className="gp-vis-card">
      {/* ── Top Header Bar & Scanner Selector ── */}
      <div className="gp-vis-header">
        <div className="gp-vis-title-group">
          <span className="gp-vis-live-dot" />
          <span className="gp-vis-headline">Interactive Detection Telemetry</span>
        </div>

        <div className="gp-vis-tabs" role="tablist">
          {SCANNERS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={selectedScannerId === s.id}
              className={`gp-vis-tab ${selectedScannerId === s.id ? "is-selected" : ""}`}
              onClick={() => setSelectedScannerId(s.id)}
            >
              {s.name.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Metrics Dashboard Grid ── */}
      <div className="gp-vis-metrics">
        <div className="gp-vis-metric-item">
          <div className="gp-vis-metric-label">
            <Shield size={14} color="var(--accent)" />
            <span>Detection Coverage</span>
          </div>
          <div className="gp-vis-metric-val" style={{ color: scanner.statusColor }}>
            {scanner.detectedCount} / {scanner.totalCount}
            <span className="gp-vis-metric-sub">classes</span>
          </div>
        </div>

        <div className="gp-vis-metric-item">
          <div className="gp-vis-metric-label">
            <Clock size={14} color="var(--fg-dim)" />
            <span>Latency / Speed</span>
          </div>
          <div className="gp-vis-metric-val">{scanner.speed}</div>
        </div>

        <div className="gp-vis-metric-item">
          <div className="gp-vis-metric-label">
            <DollarSign size={14} color="var(--fg-dim)" />
            <span>Cost per Scan</span>
          </div>
          <div className="gp-vis-metric-val">{scanner.cost}</div>
        </div>

        <div className="gp-vis-metric-item">
          <div className="gp-vis-metric-label">
            <RefreshCw size={14} color={scanner.deterministic ? "#2DD4BF" : "#F59E0B"} />
            <span>Determinism</span>
          </div>
          <div className="gp-vis-metric-val" style={{ fontSize: 15 }}>
            {scanner.deterministic ? "100% Byte-Identical" : "Non-Deterministic"}
          </div>
        </div>
      </div>

      {/* ── 12-Class Detection Status Grid ── */}
      <div className="gp-vis-body">
        <div className="gp-vis-section-title">
          <span>Agentic Vulnerability Class Matrix</span>
          <span
            className="gp-vis-scanner-badge"
            style={{ borderColor: scanner.statusColor, color: scanner.statusColor }}
          >
            {scanner.badge}
          </span>
        </div>

        <div className="gp-vis-class-grid">
          {scanner.classes.map((c) => (
            <div key={c.name} className={`gp-vis-class-chip ${c.status}`}>
              <div className="gp-vis-chip-left">
                {c.status === "detected" ? (
                  <CheckCircle2 size={15} color="#2DD4BF" />
                ) : c.status === "fp" ? (
                  <RefreshCw size={15} color="#F59E0B" />
                ) : (
                  <XCircle size={15} color="#EF4444" />
                )}
                <span className="gp-vis-class-name">{c.name}</span>
              </div>
              <span className="gp-vis-asi-tag">{c.asi}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
