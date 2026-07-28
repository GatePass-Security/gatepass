"use client";

import { useEffect, useState } from "react";
import {
  GitPullRequest,
  Zap,
  ShieldCheck,
  FileCheck2,
  Terminal as TerminalIcon,
  Check,
  Copy,
  Layers,
  Sparkles,
  Code2,
  Cpu,
  RefreshCw,
} from "lucide-react";

interface Step {
  id: string;
  num: string;
  title: string;
  badge: string;
  headline: string;
  description: string;
  icon: typeof GitPullRequest;
  metrics: { label: string; value: string }[];
}

const STEPS: [Step, Step, Step, Step] = [
  {
    id: "connect",
    num: "01",
    title: "Connect & Parse",
    badge: "Read-Only Connection",
    headline: "Parses your repository into 5 surfaces simultaneously",
    description:
      "Install the read-only GitHub App. Gatepass analyzes application code, MCP tool descriptions, transport bindings, OAuth scopes, and database row-level security in a unified AST pass.",
    icon: Layers,
    metrics: [
      { label: "Surfaces Analyzed", value: "5 / 5" },
      { label: "Install Time", value: "< 30s" },
      { label: "Access Policy", value: "Read-only" },
    ],
  },
  {
    id: "engine",
    num: "02",
    title: "Cross-Surface Analysis",
    badge: "Deterministic Engine",
    headline: "Cross-surface reasoning in roughly a millisecond",
    description:
      "A scope mismatch only exists between the manifest and the tool that exceeds it. Gatepass correlates call-sites against grants in-process, so a verdict never waits on a queue or an inference call.",
    icon: Zap,
    metrics: [
      { label: "Scan Latency", value: "~1.1ms" },
      { label: "Model Calls", value: "None" },
      { label: "Detectors Active", value: "12 / 12" },
    ],
  },
  {
    id: "remediate",
    num: "03",
    title: "In-Workflow Fixes",
    badge: "Remediation Loop",
    headline: "Fix suggestions in PRs and direct guidance to your coding agent",
    description:
      "Findings arrive as inline PR comments with suggested diffs, and opt-in structured guidance fed directly to Cursor or Claude Code — so the human developer approves, but never writes boilerplate fixes.",
    icon: GitPullRequest,
    metrics: [
      { label: "Reproduction Tier", value: "Machine-checked" },
      { label: "IDE Integrations", value: "Cursor / Claude Code" },
      { label: "PR Gate Default", value: "Fail-open" },
    ],
  },
  {
    id: "evidence",
    num: "04",
    title: "Audit & Compliance",
    badge: "SOC 2 / ISO Feed",
    headline: "Signed compliance evidence and questionnaire auto-fill",
    description:
      "Scan posture exports automatically to Vanta and Drata via API, and auto-drafts enterprise security questionnaires. Every finding carries a verified reproduction proof — file, line, and commit hash.",
    icon: ShieldCheck,
    metrics: [
      { label: "Integrations", value: "Vanta / Drata" },
      { label: "Proof Model", value: "Signed SHA-256" },
      { label: "Audit Format", value: "JSON / OSCAL" },
    ],
  },
];

const SURFACES = [
  { name: "App Source Code", detail: "Next.js / Supabase / FastAPI / Go", status: "Parsed", color: "#34d399" },
  { name: "MCP Tool Schemas", detail: "JSON-Schema bounds & string params", status: "Parsed", color: "#2dd4bf" },
  { name: "Server Transports", detail: "HTTP / SSE / StdIO endpoint bindings", status: "Parsed", color: "#a78bfa" },
  { name: "OAuth & Grants", detail: "Manifest scopes vs runtime capabilities", status: "Correlated", color: "#fbbf24" },
  { name: "DB Security Rules", detail: "Tenant tables & Row-Level Security", status: "Verified", color: "#60a5fa" },
];

export function HowItWorksInteractive() {
  const [activeStep, setActiveStep] = useState(0);
  const [appliedDiff, setAppliedDiff] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  // Auto advance every 5s continuously in a loop from step 1 to 4
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % STEPS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const step = STEPS[activeStep] ?? STEPS[0];

  const handleCopyPayload = () => {
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="gp-how-interactive" aria-label="Interactive workflow demonstration">
      {/* ── Top Stepper Navigation ── */}
      <div className="gp-how-nav" role="tablist">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = activeStep === i;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`step-panel-${s.id}`}
              className={`gp-how-tab ${isActive ? "is-active" : ""}`}
              onClick={() => setActiveStep(i)}
            >
              <div className="gp-how-tab-top">
                <span className="gp-how-tab-num">{s.num}</span>
                <Icon size={18} className="gp-how-tab-icon" />
              </div>
              <div className="gp-how-tab-title">{s.title}</div>
              <div className="gp-how-tab-badge">{s.badge}</div>
              {isActive && <div className="gp-how-tab-progress" key={activeStep} />}
            </button>
          );
        })}
      </div>

      {/* ── Main Interactive Stage Grid ── */}
      <div className="gp-how-grid">
        {/* Left Column: Context & Key Highlights */}
        <div className="gp-how-info">
          <div className="gp-how-pill">
            <Sparkles size={14} className="gp-how-sparkle" />
            <span>
              Phase {step.num} of 04 · {step.badge}
            </span>
          </div>

          <h3 className="gp-how-headline">{step.headline}</h3>
          <p className="gp-how-desc">{step.description}</p>

          {/* Key Metrics */}
          <div className="gp-how-metrics">
            {step.metrics.map((m) => (
              <div key={m.label} className="gp-how-metric-card">
                <div className="gp-how-metric-value">{m.value}</div>
                <div className="gp-how-metric-label">{m.label}</div>
              </div>
            ))}
          </div>

          {/* Action guidance callout */}
          <div className="gp-how-hint">
            <span className="gp-how-hint-pulse" />
            <span>
              {activeStep === 0 && "Parsing codebase AST and tool definitions simultaneously..."}
              {activeStep === 1 && "Correlating call sites with OAuth manifest bounds..."}
              {activeStep === 2 && "Click [Simulate Fix] on the right to test one-click diff remediation."}
              {activeStep === 3 && "Verified evidence auto-syncing to Vanta / Drata APIs..."}
            </span>
          </div>
        </div>

        {/* Right Column: Cybernetic Interactive Visual Sandbox */}
        <div className="gp-sandbox" id={`step-panel-${step.id}`} role="tabpanel">
          {/* Header Bar */}
          <div className="gp-sandbox-head">
            <div className="gp-sandbox-dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>

            <div className="gp-sandbox-title">
              <TerminalIcon size={13} />
              <span>gatepass-engine // {step.id}.stage</span>
            </div>

            <div className="gp-sandbox-status">
              <span className="pulse-live" />
              <span>LIVE DEMO</span>
            </div>
          </div>

          {/* Dynamic Content View depending on activeStep */}
          <div className="gp-sandbox-body">
            {/* VIEW 01: Connect & Surface Discovery */}
            {activeStep === 0 && (
              <div className="gp-view-surfaces">
                <div className="gp-surface-header">
                  <div className="gp-surface-tag">
                    <Layers size={14} />
                    <span>AST Surface Registry</span>
                  </div>
                  <span className="gp-surface-count">5 surfaces mapped</span>
                </div>

                <div className="gp-surface-list">
                  {SURFACES.map((surf, idx) => (
                    <div key={surf.name} className="gp-surface-item" style={{ "--delay": idx } as React.CSSProperties}>
                      <div className="gp-surface-left">
                        <div className="gp-surface-dot" style={{ background: surf.color }} />
                        <div>
                          <div className="gp-surface-name">{surf.name}</div>
                          <div className="gp-surface-detail">{surf.detail}</div>
                        </div>
                      </div>
                      <span className="gp-surface-status" style={{ color: surf.color, borderColor: `${surf.color}40` }}>
                        {surf.status}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="gp-surface-footer">
                  <span>Repository tree indexed in 0.4s</span>
                  <span className="gp-mono text-accent">read-only boundary ok</span>
                </div>
              </div>
            )}

            {/* VIEW 02: Cross-Surface Engine */}
            {activeStep === 1 && (
              <div className="gp-view-engine">
                <div className="gp-engine-card">
                  <div className="gp-engine-top">
                    <span className="gp-chip gp-chip-critical">HIGH SEVERITY</span>
                    <span className="gp-mono gp-dim-text">ASI03 · Privilege Abuse</span>
                  </div>
                  <div className="gp-engine-title">Cross-Surface Scope Mismatch</div>
                  <div className="gp-engine-diagram">
                    <div className="gp-engine-box">
                      <div className="gp-box-label">OAuth App Manifest</div>
                      <div className="gp-box-code text-green">repo:read</div>
                      <div className="gp-box-code text-green">issues:read</div>
                    </div>

                    <div className="gp-engine-link">
                      <div className="gp-link-line" />
                      <span className="gp-link-badge">MISMATCH</span>
                    </div>

                    <div className="gp-engine-box alert">
                      <div className="gp-box-label">Tool Runtime Grants</div>
                      <div className="gp-box-code text-danger">repo:write</div>
                      <div className="gp-box-code text-danger">admin:org</div>
                    </div>
                  </div>

                  <div className="gp-engine-finding">
                    <span className="icon-warn">!</span>
                    <span>Tool surface exceeds the scopes the app was granted at install.</span>
                  </div>
                </div>

                <div className="gp-engine-bar">
                  <div className="gp-engine-stat">
                    <Zap size={14} className="text-accent" />
                    <span>
                      Scan latency: <strong>1.1ms</strong>
                    </span>
                  </div>
                  <div className="gp-engine-stat">
                    <Cpu size={14} />
                    <span>
                      Model calls: <strong>0</strong>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 03: In-Workflow Remediation */}
            {activeStep === 2 && (
              <div className="gp-view-remediate">
                <div className="gp-pr-header">
                  <div className="gp-pr-title">
                    <GitPullRequest size={15} className="text-accent" />
                    <span>PR #142 · Fix tool scope definition</span>
                  </div>
                  <button
                    type="button"
                    className={`gp-diff-btn ${appliedDiff ? "is-applied" : ""}`}
                    onClick={() => setAppliedDiff(!appliedDiff)}
                  >
                    <RefreshCw size={13} className={appliedDiff ? "spin-once" : ""} />
                    <span>{appliedDiff ? "Reset Demo Code" : "Simulate Fix Diff"}</span>
                  </button>
                </div>

                <div className="gp-diff-box">
                  <div className="gp-diff-file">
                    <FileCheck2 size={13} />
                    <span>src/mcp/tools/search.ts</span>
                  </div>

                  <pre className="gp-code">
                    <code>
                      <span className="cm">// MCP tool permission grant definition</span>
                      {"\n"}
                      <span className="kw">export const</span> <span className="nm">searchTool</span> = {"{"}
                      {"\n"}
                      {"  "}name: <span className="st">&quot;search_docs&quot;</span>,{"\n"}
                      {appliedDiff ? (
                        <>
                          <span className="diff-add">
                            + {"  "}scopes: [<span className="st">&quot;repo:read&quot;</span>],{" "}
                            <span className="cm">// Restricted scope</span>
                          </span>
                          {"\n"}
                          <span className="diff-add">
                            + {"  "}schemaValidation: <span className="kw">true</span>,
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="diff-del">
                            - {"  "}scopes: [<span className="st">&quot;repo:write&quot;</span>,{" "}
                            <span className="st">&quot;admin:org&quot;</span>],
                          </span>
                          {"\n"}
                          <span className="diff-del">
                            - {"  "}schemaValidation: <span className="kw">false</span>,
                          </span>
                        </>
                      )}
                      {"\n"}
                      {"}"};
                    </code>
                  </pre>
                </div>

                <div className="gp-agent-guidance">
                  <div className="gp-agent-head">
                    <Code2 size={14} className="text-accent" />
                    <span>Agent Guidance Payload (Claude Code / Cursor)</span>
                  </div>
                  <p className="gp-agent-text">
                    {appliedDiff
                      ? "✓ Guidance applied. Scope mismatch resolved and validated by gatepass engine."
                      : "Suggesting exact schema patch to Cursor. Human approval required before merge."}
                  </p>
                </div>
              </div>
            )}

            {/* VIEW 04: Audit & Compliance Export */}
            {activeStep === 3 && (
              <div className="gp-view-evidence">
                <div className="gp-evidence-head">
                  <div className="gp-evidence-brand">
                    <ShieldCheck size={16} className="text-green" />
                    <span>Vanta & Drata Compliance Feed</span>
                  </div>
                  <button type="button" className="gp-copy-btn" onClick={handleCopyPayload}>
                    {copiedPayload ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedPayload ? "Copied JSON" : "Copy Payload"}</span>
                  </button>
                </div>

                <div className="gp-proof-badge">
                  <span className="badge-pass">VERIFIED PROOF ATTACHED</span>
                  <span className="gp-mono">sha256:9c2f1ab...</span>
                </div>

                <pre className="gp-json-box">
                  <code>
                    {`{
  "finding_id": "ASI03-scope-mismatch",
  "reproduction": {
    "file": "tools/search.ts",
    "line": 41,
    "commit": "9c2f1ab",
    "status": "PASS"
  },
  "compliance_mapping": {
    "soc2": ["CC6.1", "CC6.8"],
    "iso27001": "A.12.6.1"
  },
  "verified_at": "2026-07-27T00:45:00Z"
}`}
                  </code>
                </pre>

                <div className="gp-evidence-footer">
                  <span className="status-sync">✓ Direct API Sync Active</span>
                  <span className="text-muted">Auto-drafting Questionnaire Answers</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
