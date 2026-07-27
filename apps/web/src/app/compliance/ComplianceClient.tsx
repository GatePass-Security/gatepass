"use client";

import { type ComponentType, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  Apple,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  FileCheck,
  Globe,
  Info,
  MinusCircle,
  Monitor,
  Shield,
  XCircle,
} from "lucide-react";
import type {
  ComplianceResult,
  ComplianceCheck,
  ComplianceDomain,
  ComplianceFix,
  ComplianceSeverity,
  ComplianceStatus,
} from "@gatepass/compliance";
import {
  Badge,
  Card,
  CodeBlock,
  EmptyState,
  FilterPill,
  PageHeader,
  SegmentedControl,
  TONE_TEXT,
  TONE_VAR,
  type Tone,
} from "@/components/ui";
import { cx, formatDate, pluralize, relativeTime } from "@/lib/utils";

type IconType = ComponentType<{ size?: number; className?: string }>;

// ── Domain metadata ───────────────────────────────────────────────────
// Declared locally rather than imported from `@gatepass/compliance`'s `domainMeta`
// so this client bundle keeps a type-only dependency on the package and never
// pulls the zod schemas across the server/client boundary.
const DOMAIN_ORDER = ["wcag", "ccpa", "app_store", "google_play", "eu_ai_act"] as const;

const DOMAIN_META: Record<ComplianceDomain, { short: string; label: string; icon: IconType }> = {
  wcag: { short: "WCAG", label: "Web accessibility — WCAG 2.2", icon: Eye },
  ccpa: { short: "CCPA", label: "Privacy — CCPA/CPRA", icon: Shield },
  app_store: { short: "App Store", label: "Apple App Store", icon: Apple },
  google_play: { short: "Play Store", label: "Google Play", icon: Monitor },
  eu_ai_act: { short: "EU AI", label: "EU AI Act", icon: Globe },
};

// ── Tone mapping ──────────────────────────────────────────────────────
/*
 * Compliance severity is ordinal (critical → warning → info), so it maps onto the
 * ordinal severity ramp and never borrows a categorical tier hue. Status uses the
 * categorical ones instead: `manual_review` is a research-tier "a human still has
 * to look at this", `not_applicable` is deliberately inert grey.
 */
const SEVERITY_TONE: Record<ComplianceSeverity, Tone> = {
  critical: "critical",
  warning: "high",
  info: "medium",
};

const SEVERITY_LABEL: Record<ComplianceSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  manual_review: "Manual review",
  not_applicable: "Not applicable",
};

const STATUS_ICON: Record<ComplianceStatus, IconType> = {
  pass: CheckCircle2,
  fail: XCircle,
  manual_review: Info,
  not_applicable: MinusCircle,
};

/** Failing rows take the icon of their severity so shape, not just colour, ranks them. */
const SEVERITY_ICON: Record<ComplianceSeverity, IconType> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const FIX_KIND_LABEL: Record<ComplianceFix["kind"], string> = {
  diff: "Suggested diff",
  file_create: "Create file",
  config_change: "Configuration change",
  code_change: "Code change",
};

function statusTone(check: ComplianceCheck): Tone {
  if (check.status === "pass") return "verified";
  if (check.status === "fail") return SEVERITY_TONE[check.severity];
  return check.status === "manual_review" ? "research" : "low";
}

/** Score bands are the ones the previous dashboard used — kept so the ring reads the same. */
function scoreTone(score: number): Tone {
  return score >= 80 ? "verified" : score >= 50 ? "medium" : "critical";
}

/*
 * The scanner returns 100 for a domain with no applicable checks (see `computeScore` —
 * an empty denominator scores 100). Painting that mint would claim "everything passed"
 * for a standard nothing was measured against, so an unassessed domain is rendered
 * inert instead and its counts line says so.
 */
function domainTone(stats: { pass: number; fail: number; score: number }): Tone {
  return stats.pass + stats.fail === 0 ? "low" : scoreTone(stats.score);
}

/**
 * …and the figure itself is suppressed, not just its colour. A tile reading
 * "100 /100" above the words "0 of 4 assessed" is the dashboard contradicting
 * itself in the same breath; an unmeasured domain has no score, so it shows an
 * em dash.
 */
function domainScoreLabel(stats: { pass: number; fail: number; score: number }): string {
  return stats.pass + stats.fail === 0 ? "—" : String(stats.score);
}

function scoreHeadline(score: number): string {
  if (score >= 90) return "Excellent compliance posture";
  if (score >= 70) return "Good compliance posture";
  if (score >= 50) return "Moderate compliance posture";
  return "Poor compliance posture — action needed";
}

const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const MAX_FIX_CONTENT = 800;

interface Props {
  result: ComplianceResult;
}

export default function ComplianceClient({ result }: Props) {
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "pass" | "fail">("all");
  const [filterDomain, setFilterDomain] = useState<ComplianceDomain | "all">("all");
  const panelIdPrefix = useId();

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
    return DOMAIN_ORDER.map((domain) => [domain, result.byDomain[domain]] as const).filter(
      (entry): entry is readonly [ComplianceDomain, DomainStats] => entry[1] !== undefined,
    );
  }, [result.byDomain]);

  const tone = scoreTone(result.score);
  const headline = scoreHeadline(result.score);

  // The score's denominator is pass + fail — not-applicable and manual-review checks are
  // excluded by the scanner. The caption has to use the same denominator or it describes a
  // different number than the ring above it.
  const applicable = result.passCount + result.failCount;
  const summary =
    applicable === 0
      ? `No applicable automated checks — ${result.naCount} not applicable, ${result.manualCount} awaiting manual review.`
      : result.failCount === 0
        ? `All ${applicable} applicable ${pluralize(applicable, "check")} pass.`
        : `${result.failCount} of ${applicable} applicable ${pluralize(applicable, "check")} failing.`;

  const filtersActive = filterStatus !== "all" || filterDomain !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance posture"
        description="Automated compliance scanning against WCAG 2.2, CCPA/CPRA, Apple App Store, Google Play, and EU AI Act (2026)."
        actions={
          /* PageHeader stacks below `sm`, where a right-aligned block would read as ragged. */
          <p className="text-[0.72rem] leading-relaxed text-fg-muted sm:text-right">
            <span className="block">
              Scanned{" "}
              <time dateTime={result.timestamp} title={formatDate(result.timestamp)}>
                {relativeTime(result.timestamp)}
              </time>
            </span>
            <span data-numeric className="block">
              {result.totalChecks} {pluralize(result.totalChecks, "check")} run
            </span>
          </p>
        }
      />

      {/* ═══ Overall score ═══ */}
      <Card>
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            {/* An SVG ring is invisible to a screen reader, so the whole figure carries the
                number as text and the visual arc is left decorative. */}
            <svg
              role="img"
              aria-label={`Overall compliance score ${result.score} out of 100 — ${headline}`}
              className="h-24 w-24 -rotate-90"
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-line-strong"
              />
              <circle
                cx="50"
                cy="50"
                r={RING_RADIUS}
                fill="none"
                stroke={TONE_VAR[tone]}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - result.score / 100)}
              />
            </svg>
            <span
              data-numeric
              aria-hidden="true"
              className={cx("absolute text-[1.5rem] leading-none font-medium tracking-[-0.03em]", TONE_TEXT[tone])}
            >
              {result.score}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-[1.05rem] leading-tight font-medium tracking-[-0.021em] text-fg">{headline}</h2>
            <p className="mt-1.5 text-[0.82rem] leading-relaxed text-fg-muted">{summary}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="verified" dot>
                <span data-numeric>{result.passCount}</span> passing
              </Badge>
              <Badge tone="critical" dot>
                <span data-numeric>{result.failCount}</span> failing
              </Badge>
              <Badge tone="research" dot>
                <span data-numeric>{result.manualCount}</span> manual review
              </Badge>
              <Badge tone="low" dot>
                <span data-numeric>{result.naCount}</span> not applicable
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ Per-standard scores — each card also filters the list below ═══ */}
      {domainEntries.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {domainEntries.map(([domain, stats]) => {
            const Icon = DOMAIN_META[domain].icon;
            const active = filterDomain === domain;
            return (
              <button
                key={domain}
                type="button"
                aria-pressed={active}
                aria-label={
                  stats.pass + stats.fail === 0
                    ? `Filter by ${DOMAIN_META[domain].label} — none of its ${stats.total} ${pluralize(stats.total, "check")} applicable to this project`
                    : `Filter by ${DOMAIN_META[domain].label} — score ${stats.score} of 100, ${stats.pass} passing, ${stats.fail} failing`
                }
                onClick={() => setFilterDomain(active ? "all" : domain)}
                className={cx(
                  "cursor-pointer rounded-[var(--radius-card)] border p-4 text-left",
                  "transition-colors duration-150",
                  active
                    ? "border-accent-line bg-accent-soft"
                    : "border-line bg-surface hover:border-line-strong hover:bg-raised",
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon
                    size={15}
                    className={active ? "shrink-0 text-accent" : "shrink-0 text-fg-muted"}
                    aria-hidden="true"
                  />
                  <span
                    className={cx(
                      "truncate text-[0.7rem] font-medium tracking-[0.05em] uppercase",
                      active ? "text-accent" : "text-fg-muted",
                    )}
                  >
                    {DOMAIN_META[domain].short}
                  </span>
                </span>
                <span className="mt-2.5 flex items-baseline gap-1">
                  <span
                    data-numeric
                    className={cx(
                      "text-[1.35rem] leading-none font-medium tracking-[-0.03em]",
                      TONE_TEXT[domainTone(stats)],
                    )}
                  >
                    {domainScoreLabel(stats)}
                  </span>
                  {stats.pass + stats.fail > 0 && <span className="text-[0.7rem] text-fg-faint">/100</span>}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[0.7rem]">
                  {stats.pass + stats.fail === 0 ? (
                    <span data-numeric className="text-fg-muted">
                      0 of {stats.total} assessed
                    </span>
                  ) : (
                    <>
                      <span data-numeric className="text-verified">
                        {stats.pass} pass
                      </span>
                      {stats.fail > 0 && (
                        <span data-numeric className="text-critical">
                          {stats.fail} fail
                        </span>
                      )}
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ═══ Filters ═══ */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl
            label="Filter checks by status"
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: "all", label: "All" },
              { value: "fail", label: "Failing" },
              { value: "pass", label: "Passing" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter checks by standard">
            <FilterPill
              active={filterDomain === "all"}
              onClick={() => setFilterDomain("all")}
              count={result.checks.length}
            >
              All standards
            </FilterPill>
            {domainEntries.map(([domain, stats]) => (
              <FilterPill
                key={domain}
                active={filterDomain === domain}
                onClick={() => setFilterDomain(domain)}
                count={stats.total}
              >
                {DOMAIN_META[domain].short}
              </FilterPill>
            ))}
          </div>
        </div>
        <p aria-live="polite" className="text-[0.75rem] text-fg-muted">
          Showing <span data-numeric>{filteredChecks.length}</span> of <span data-numeric>{result.checks.length}</span>{" "}
          {pluralize(result.checks.length, "check")}
        </p>
      </div>

      {/* ═══ Checks ═══ */}
      {filteredChecks.length === 0 ? (
        <EmptyState
          icon={<FileCheck className="h-5 w-5" />}
          title="No checks match these filters"
          description={
            result.checks.length === 0
              ? "This scan produced no compliance checks."
              : "Widen the status or standard filter to see the rest of the scan."
          }
          action={
            filtersActive
              ? {
                  label: "Clear filters",
                  onClick: () => {
                    setFilterStatus("all");
                    setFilterDomain("all");
                  },
                }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {filteredChecks.map((check) => {
            const checkTone = statusTone(check);
            const StatusIcon = check.status === "fail" ? SEVERITY_ICON[check.severity] : STATUS_ICON[check.status];
            const expanded = expandedRule === check.ruleId;
            const panelId = `${panelIdPrefix}-${check.ruleId}`;
            const newContent = check.fix?.newContent;

            return (
              <li key={check.ruleId}>
                <Card padding={false}>
                  <button
                    type="button"
                    onClick={() => setExpandedRule(expanded ? null : check.ruleId)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className="flex w-full cursor-pointer items-start gap-3 p-4 text-left transition-colors duration-150 hover:bg-raised/60"
                  >
                    {/* Decorative: the status is already spelled out in the badge beside the title. */}
                    <StatusIcon size={17} className={cx("mt-0.5 shrink-0", TONE_TEXT[checkTone])} aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.855rem] font-medium text-fg">{check.title}</span>
                        <Badge tone={SEVERITY_TONE[check.severity]} size="sm">
                          {SEVERITY_LABEL[check.severity]}
                        </Badge>
                        <Badge size="sm">{DOMAIN_META[check.domain].short}</Badge>
                        <Badge tone={checkTone} size="sm" dot>
                          {STATUS_LABEL[check.status]}
                        </Badge>
                      </span>
                      <span className="line-clamp-2 text-[0.78rem] leading-relaxed text-fg-muted">
                        {check.description}
                      </span>
                    </span>
                    {/* aria-expanded on the button already announces the state. */}
                    {expanded ? (
                      <ChevronDown size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
                    ) : (
                      <ChevronRight size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
                    )}
                  </button>

                  {expanded && (
                    <div id={panelId} className="space-y-4 border-t border-line px-4 py-4">
                      {/* The collapsed row clamps the description to two lines; this is the
                          unclipped copy, and it guarantees the panel is never empty for a
                          check that carries no locations and no fix. */}
                      <p className="text-[0.82rem] leading-relaxed text-fg-secondary">{check.description}</p>

                      {check.locations.length > 0 && (
                        <div>
                          <h3 className="text-[0.7rem] font-medium tracking-[0.05em] text-fg-muted uppercase">
                            {pluralize(check.locations.length, "Location")}
                          </h3>
                          <ul className="mt-2 space-y-1">
                            {check.locations.map((loc, i) => (
                              <li
                                key={`${loc.path}-${loc.startLine ?? i}`}
                                className="overflow-x-auto rounded-[0.6rem] border border-line bg-sunken px-2.5 py-1.5"
                              >
                                <span className="flex items-center gap-2.5 font-mono text-[0.72rem] whitespace-nowrap">
                                  <span className="text-fg-secondary">
                                    {loc.path}
                                    {loc.startLine ? `:${loc.startLine}` : ""}
                                  </span>
                                  {loc.snippet && <span className="text-fg-muted">{loc.snippet}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {check.fix && (
                        <div className="space-y-2.5">
                          <h3 className="flex items-center gap-2 text-[0.7rem] font-medium tracking-[0.05em] text-fg-muted uppercase">
                            <Code2 size={13} className="shrink-0" aria-hidden="true" />
                            {FIX_KIND_LABEL[check.fix.kind]}
                          </h3>
                          <p className="text-[0.82rem] leading-relaxed text-fg-secondary">{check.fix.description}</p>

                          {check.fix.diff && (
                            <CodeBlock title={check.fix.filePath ?? "suggested diff"} content={check.fix.diff} diff />
                          )}

                          {newContent && (
                            <CodeBlock
                              title={check.fix.filePath ?? "new file"}
                              content={
                                newContent.length > MAX_FIX_CONTENT
                                  ? `${newContent.slice(0, MAX_FIX_CONTENT)}\n/* ... truncated */`
                                  : newContent
                              }
                              maxHeight="18rem"
                            />
                          )}
                        </div>
                      )}

                      {check.status === "pass" && (
                        <p className="flex items-center gap-2 text-[0.78rem] text-verified">
                          <CheckCircle2 size={13} className="shrink-0" aria-hidden="true" />
                          Passed automatically — no action required.
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
