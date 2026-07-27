"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Search,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import type { Finding, Reproduction, Severity, Surface, Tier } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { FilterPill, SegmentedControl } from "@/components/ui/FilterPill";
import { Textarea } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat, TONE_FILL, TONE_SOFT, type Tone } from "@/components/ui/Stat";
import { useToast } from "@/components/ui/Toast";
import {
  SEVERITY_ORDER,
  confidencePercent,
  cx,
  pluralize,
  severityLabel,
  severityToken,
  sharePercent,
  tierToken,
} from "@/lib/utils";

interface Props {
  findings: Finding[];
  scanId?: string;
  error: string | null;
}

type TierFilter = "all" | Tier;
type SeverityFilter = "all" | Severity;

const TIER_OPTIONS: Array<{ value: TierFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "research", label: "Research" },
];

/*
 * Worst first. Derived from SEVERITY_ORDER rather than re-listed so the display
 * order can never drift from the canonical ramp in lib/utils.
 */
const SEVERITY_RANK = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i])) as Record<Severity, number>;

/** Within one severity the reproducible claim outranks the probabilistic one. */
const TIER_RANK: Record<Tier, number> = { verified: 0, research: 1 };

const SURFACE_LABEL: Record<Surface, string> = {
  app_code: "App code",
  agent_code: "Agent code",
  mcp_server: "MCP server",
  tool_defs: "Tool definitions",
  permission_scopes: "Permission scopes",
};

/*
 * severityToken()/tierToken() are the single source for the ramp, but they
 * return `string` so lib/utils carries no dependency on the UI layer. Their
 * outputs are exactly Tone members — this is the one place that boundary is
 * crossed, instead of every call site guessing at a colour.
 */
const severityTone = (severity: Severity): Tone => severityToken(severity) as Tone;
const tierTone = (tier: Tier): Tone => tierToken(tier) as Tone;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const PAGE_DESCRIPTION =
  "Two-tier results from the latest scan. Verified findings carry a reproduction; research findings carry a confidence score.";

export default function FindingsClient({ findings, scanId, error }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const rawQuery = searchParams.get("q") ?? "";
  const query = rawQuery.toLowerCase();

  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  /* Disputes suppress org-wide on the server, so the row is dropped locally
     rather than left behind for a refresh to clear. */
  const [disputed, setDisputed] = useState<ReadonlySet<string>>(() => new Set());

  const live = useMemo(() => findings.filter((f) => !disputed.has(f.fingerprint)), [findings, disputed]);

  const totals = useMemo(() => {
    const verified = live.filter((f) => f.tier === "verified");
    const research = live.filter((f) => f.tier === "research");
    const critical = live.filter((f) => f.severity === "critical");
    const confidences = research.map((f) => (f.tier === "research" ? f.confidence : 0));
    return {
      total: live.length,
      verified: verified.length,
      research: research.length,
      critical: critical.length,
      criticalVerified: critical.filter((f) => f.tier === "verified").length,
      classes: new Set(live.map((f) => f.classId)).size,
      medianConfidence: confidences.length > 0 ? medianOf(confidences) : null,
    };
  }, [live]);

  /* Tier + text search define the scope the severity chips count within, so a
     chip's number is always what clicking it would actually yield. */
  const scoped = useMemo(
    () =>
      live.filter((f) => {
        if (tierFilter !== "all" && f.tier !== tierFilter) return false;
        if (!query) return true;
        const hay =
          `${f.classId} ${f.severity} ${f.tier} ${f.explanation} ${f.locations.map((l) => l.path).join(" ")}`.toLowerCase();
        return hay.includes(query);
      }),
    [live, tierFilter, query],
  );

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of scoped) counts[f.severity] += 1;
    return counts;
  }, [scoped]);

  const filtered = useMemo(
    () =>
      scoped
        .filter((f) => severityFilter === "all" || f.severity === severityFilter)
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || TIER_RANK[a.tier] - TIER_RANK[b.tier]),
    [scoped, severityFilter],
  );

  const filtersActive = tierFilter !== "all" || severityFilter !== "all" || rawQuery !== "";

  /* sharePercent, not Math.round: 999 of 1000 must not caption "100%" while the
     Research tile beside it still shows 1. */
  const verifiedSharePct = sharePercent(totals.verified, totals.total);
  const verifiedShare = verifiedSharePct ? `${verifiedSharePct} of findings` : undefined;

  function clearFilters() {
    setTierFilter("all");
    setSeverityFilter("all");
    if (rawQuery) router.replace("/findings");
  }

  async function submitDispute(finding: Finding, reason: string) {
    if (!scanId) return;
    setDisputing(finding.fingerprint);
    setDisputeError(null);
    try {
      await api.disputeFinding(finding.fingerprint, scanId, reason);
      setDisputed((prev) => new Set(prev).add(finding.fingerprint));
      setDisputeFor(null);
      setExpanded((prev) => (prev === finding.fingerprint ? null : prev));
      toast(`${finding.classId} disputed — suppressed for this org`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Dispute failed";
      setDisputeError(message);
      toast(message, "error");
    } finally {
      setDisputing(null);
    }
  }

  const header = (
    <PageHeader
      title="Findings"
      description={PAGE_DESCRIPTION}
      actions={
        scanId ? (
          <Badge tone="neutral">
            Scan
            <span className="max-w-[11rem] truncate font-mono text-fg-muted">{scanId}</span>
          </Badge>
        ) : undefined
      }
    />
  );

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title="Could not load findings" message={error} onRetry={() => router.refresh()} />
      </div>
    );
  }

  if (live.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        {findings.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No findings yet"
            description="Scan a repository and its verified and research findings will appear here."
          />
        ) : (
          <EmptyState
            icon={<ShieldOff className="h-5 w-5" />}
            title="Every finding disputed"
            description="All findings in this scan have been disputed and are suppressed for this org."
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total"
          value={totals.total}
          icon={<Search className="h-4 w-4" aria-hidden="true" />}
          caption={`${totals.classes} distinct ${pluralize(totals.classes, "class", "classes")}`}
        />
        <Stat
          label="Verified"
          value={totals.verified}
          tone="verified"
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          caption={verifiedShare}
        />
        <Stat
          label="Research"
          value={totals.research}
          tone="research"
          icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}
          caption={
            totals.medianConfidence === null
              ? undefined
              : `Median confidence ${confidencePercent(totals.medianConfidence)}`
          }
        />
        <Stat
          label="Critical"
          value={totals.critical}
          tone="critical"
          icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          caption={totals.critical > 0 ? `${totals.criticalVerified} verified` : undefined}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Filter by tier" value={tierFilter} options={TIER_OPTIONS} onChange={setTierFilter} />
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
          {SEVERITY_ORDER.map((s) => (
            <FilterPill
              key={s}
              active={severityFilter === s}
              tone={severityTone(s)}
              count={severityCounts[s]}
              onClick={() => setSeverityFilter(severityFilter === s ? "all" : s)}
            >
              {severityLabel(s)}
            </FilterPill>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p role="status" aria-live="polite" className="text-[0.78rem] text-fg-muted">
            <span data-numeric>{filtered.length}</span> of <span data-numeric>{live.length}</span>{" "}
            {pluralize(live.length, "finding")}
          </p>
          {rawQuery && (
            <>
              <Badge tone="neutral" size="sm">
                Search: {rawQuery}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => router.replace("/findings")}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear search
              </Button>
            </>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title="No findings match these filters"
          description="Widen the tier or severity filter, or clear the search, to see the rest of this scan."
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((finding) => (
            <li key={finding.fingerprint}>
              <FindingCard
                finding={finding}
                expanded={expanded === finding.fingerprint}
                onToggleExpand={() => setExpanded(expanded === finding.fingerprint ? null : finding.fingerprint)}
                disputeOpen={disputeFor === finding.fingerprint}
                onOpenDispute={() => {
                  setDisputeError(null);
                  setDisputeFor(finding.fingerprint);
                }}
                onCancelDispute={() => {
                  setDisputeError(null);
                  setDisputeFor(null);
                }}
                onSubmitDispute={(reason) => submitDispute(finding, reason)}
                busy={disputing === finding.fingerprint}
                disputeError={disputeFor === finding.fingerprint ? disputeError : null}
                canDispute={Boolean(scanId)}
              />
            </li>
          ))}
        </ul>
      )}

      {filtersActive && filtered.length > 0 && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

interface FindingCardProps {
  finding: Finding;
  expanded: boolean;
  onToggleExpand: () => void;
  disputeOpen: boolean;
  onOpenDispute: () => void;
  onCancelDispute: () => void;
  onSubmitDispute: (reason: string) => void;
  busy: boolean;
  disputeError: string | null;
  canDispute: boolean;
}

const NO_SCAN_REASON = "Disputing needs a scan to record against, and no scan is loaded for these findings.";

function FindingCard({
  finding,
  expanded,
  onToggleExpand,
  disputeOpen,
  onOpenDispute,
  onCancelDispute,
  onSubmitDispute,
  busy,
  disputeError,
  canDispute,
}: FindingCardProps) {
  const sevTone = severityTone(finding.severity);
  const detailId = `finding-detail-${finding.fingerprint}`;
  const primary = finding.locations[0];

  const disputeButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onOpenDispute}
      disabled={!canDispute || disputeOpen}
      title={canDispute ? undefined : NO_SCAN_REASON}
    >
      <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
      Dispute
    </Button>
  );

  return (
    <Card padding={false}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {/* Dot and title are one flex item so a long classId wrapping to the
                  next line can never leave the severity dot stranded above it. */}
              <span className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", TONE_FILL[sevTone])} aria-hidden="true" />
                <h2 className="text-[0.9rem] font-medium break-words text-fg">{finding.classId}</h2>
              </span>
              <Badge tone={sevTone} size="sm">
                {severityLabel(finding.severity)}
              </Badge>
              <Badge tone={tierTone(finding.tier)} size="sm">
                {finding.tier === "verified" ? "Verified" : `Research · ${confidencePercent(finding.confidence)}`}
              </Badge>
            </div>
            {primary && (
              <p className="mt-1.5 truncate font-mono text-[0.72rem] text-fg-muted" title={primary.path}>
                {primary.path}:{primary.startLine}
                {finding.locations.length > 1 && (
                  <span className="font-sans">
                    {" "}
                    +{finding.locations.length - 1} more {pluralize(finding.locations.length - 1, "location")}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* A disabled button swallows pointer events in some browsers, so the
                explanation also hangs off a wrapper that always receives them. */}
            {canDispute ? disputeButton : <span title={NO_SCAN_REASON}>{disputeButton}</span>}
            <IconButton
              label={expanded ? `Collapse details for ${finding.classId}` : `Expand details for ${finding.classId}`}
              size="sm"
              aria-expanded={expanded}
              aria-controls={expanded ? detailId : undefined}
              onClick={onToggleExpand}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
            </IconButton>
          </div>
        </div>
      </div>

      {expanded && (
        <div id={detailId} className="space-y-5 border-t border-line p-4 sm:p-5">
          <p className="text-[0.855rem] leading-relaxed text-fg-secondary">{finding.explanation}</p>

          {finding.tier === "research" && <ConfidenceMeter confidence={finding.confidence} />}

          {finding.tier === "verified" && <ReproductionPanel reproduction={finding.reproduction} />}

          <section>
            <SectionLabel>Locations</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {finding.locations.map((loc, i) => (
                <li key={`${loc.path}:${loc.startLine}:${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.76rem] break-all text-fg-secondary">
                    {loc.path}:{loc.startLine}-{loc.endLine}
                  </span>
                  <Badge tone="neutral" size="sm">
                    {SURFACE_LABEL[loc.surface]}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionLabel>Surfaces affected</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {finding.surfaces.map((s) => (
                <Badge key={s} tone="neutral" size="sm">
                  {SURFACE_LABEL[s]}
                </Badge>
              ))}
            </div>
          </section>

          {finding.suggestedFix && (
            <section>
              <SectionLabel>Suggested fix</SectionLabel>
              <div className="mt-2">
                <CodeBlock
                  title={finding.suggestedFix.kind === "diff" ? "suggested diff" : "agent guidance"}
                  content={finding.suggestedFix.content}
                  diff={finding.suggestedFix.kind === "diff"}
                />
              </div>
            </section>
          )}
        </div>
      )}

      {disputeOpen && (
        <div className="border-t border-line p-4 sm:p-5">
          <DisputePanel busy={busy} error={disputeError} onCancel={onCancelDispute} onSubmit={onSubmitDispute} />
        </div>
      )}
    </Card>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h3 className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">{children}</h3>;
}

/**
 * Verified findings are the product's guarantee, so the reproduction is given
 * its own toned panel rather than being one more paragraph in the stack.
 */
function ReproductionPanel({ reproduction }: { reproduction: Reproduction }) {
  return (
    <section className={cx("rounded-[0.75rem] border p-4", TONE_SOFT.verified)}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-verified" aria-hidden="true" />
        <h3 className="text-[0.82rem] font-medium text-verified">Reproduction</h3>
        <Badge tone="verified" size="sm">
          {reproduction.kind}
        </Badge>
      </div>

      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[0.82rem] leading-relaxed text-fg-secondary marker:font-medium marker:text-verified">
        {reproduction.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <div className="mt-3 rounded-[0.6rem] border border-verified-line bg-surface px-3 py-2.5">
        <p className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Expected</p>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-fg-secondary">{reproduction.expected}</p>
      </div>
    </section>
  );
}

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Confidence</SectionLabel>
        <span data-numeric className="text-[0.82rem] font-medium text-research">
          {confidencePercent(confidence)}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Research confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised"
      >
        <div className={cx("h-full rounded-full", TONE_FILL.research)} style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

/** Mounted only while open, so the reason resets each time the panel is opened. */
function DisputePanel({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <div>
      <Textarea
        label="Reason for dispute"
        hint="Suppresses this finding for the whole org and is recorded against the scan."
        placeholder="Explain why this finding is not valid…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error ?? undefined}
        disabled={busy}
        rows={3}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="danger" size="sm" onClick={() => onSubmit(trimmed)} disabled={!trimmed} isLoading={busy}>
          {busy ? "Submitting…" : "Submit dispute"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
