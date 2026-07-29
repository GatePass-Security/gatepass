"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  GitPullRequest,
  Search,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useOrgId } from "@/providers/SessionProvider";
import type { Finding, FixEdit, FixPullRequestResult, Severity, Tier } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorPanel } from "@/components/ui/EmptyState";
import { FilterPill, SegmentedControl } from "@/components/ui/FilterPill";
import { Textarea } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat, TONE_FILL } from "@/components/ui/Stat";
import { FindingDetail, severityTone, tierTone } from "@/components/FindingDetail";
import { errorToast, explainError, type FriendlyError } from "@/lib/errors";
import { useToast } from "@/components/ui/Toast";
import { SEVERITY_ORDER, confidencePercent, cx, pluralize, severityLabel, sharePercent } from "@/lib/utils";

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

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const PAGE_DESCRIPTION =
  "Two-tier results from the latest scan. Verified findings carry a reproduction; research findings carry a confidence score.";

/**
 * A finding paired with the edit Gatepass could actually commit.
 *
 * The schema pairs `kind === "diff"` with `edit`, but as a `.refine` rather than
 * a discriminated union, so TypeScript will not narrow `edit` off `kind` alone.
 * Pulling the edit out once — the same way `planFiles` does server-side — keeps
 * the rest of this file free of non-null assertions.
 */
interface ApplicableFix {
  finding: Finding;
  edit: FixEdit;
}

function applicableFixes(findings: readonly Finding[]): ApplicableFix[] {
  return findings.flatMap((finding) => {
    const edit = finding.suggestedFix?.kind === "diff" ? finding.suggestedFix.edit : undefined;
    return edit ? [{ finding, edit }] : [];
  });
}

const NO_APPLICABLE_FIX_REASON =
  "Every fix in this scan is guidance-only — it needs a value a person has to choose, so there is nothing Gatepass can commit.";

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
  const [disputeError, setDisputeError] = useState<FriendlyError | null>(null);
  /* Disputes suppress org-wide on the server, so the row is dropped locally
     rather than left behind for a refresh to clear. */
  const [disputed, setDisputed] = useState<ReadonlySet<string>>(() => new Set());
  const [fixPrOpen, setFixPrOpen] = useState(false);

  const live = useMemo(() => findings.filter((f) => !disputed.has(f.fingerprint)), [findings, disputed]);

  /* Disputed findings are excluded here for the same reason the server excludes
     them: a finding a human rejected must not come back as a commit. */
  const applicable = useMemo(() => applicableFixes(live), [live]);

  /* Stable, because the dialog's focus-trap effect depends on it — an inline
     arrow would tear down and re-run that effect (and steal focus back) on every
     re-render of this page while the dialog is open. */
  const closeFixPr = useCallback(() => setFixPrOpen(false), []);

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
      setDisputeError(explainError(e, { action: "dispute this finding" }));
      toast(errorToast(e, { action: "dispute this finding" }), "error");
    } finally {
      setDisputing(null);
    }
  }

  /* The action needs a scan to write against and findings to write from, so it
     is absent — not disabled — on the error and zero-finding surfaces, where a
     greyed-out control would be one more thing to read and nothing to act on. */
  const canOfferFixPr = Boolean(scanId) && live.length > 0;

  const fixPrButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => setFixPrOpen(true)}
      disabled={applicable.length === 0}
      title={applicable.length === 0 ? NO_APPLICABLE_FIX_REASON : undefined}
    >
      <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
      Open fix pull request
    </Button>
  );

  const header = (
    <PageHeader
      title="Findings"
      description={PAGE_DESCRIPTION}
      actions={
        scanId ? (
          <>
            <Badge tone="neutral">
              Scan
              <span className="max-w-[11rem] truncate font-mono text-fg-muted">{scanId}</span>
            </Badge>
            {/* A disabled button swallows pointer events in some browsers, so the
                explanation also hangs off a wrapper that always receives them. */}
            {canOfferFixPr &&
              (applicable.length === 0 ? <span title={NO_APPLICABLE_FIX_REASON}>{fixPrButton}</span> : fixPrButton)}
          </>
        ) : undefined
      }
    />
  );

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={new Error(error)} context={{ action: "load findings" }} onRetry={() => router.refresh()} />
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

      {fixPrOpen && scanId && <FixPullRequestDialog scanId={scanId} fixes={applicable} onClose={closeFixPr} />}

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
  disputeError: FriendlyError | null;
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
        <div id={detailId} className="border-t border-line p-4 sm:p-5">
          <FindingDetail finding={finding} />
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

/** Mounted only while open, so the reason resets each time the panel is opened. */
function DisputePanel({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: FriendlyError | null;
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
        error={error?.title}
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

const FIX_PR_CONTEXT = { action: "open a fix pull request" } as const;

/**
 * What Gatepass will and will not do, stated before anything happens rather than
 * explained afterwards. The constitution forbids writing to customer code and
 * CI; this is the one narrow, human-triggered exception, so the exact shape of
 * it is spelled out on the confirmation step instead of living only in a doc.
 */
const FIX_PR_GUARANTEES = [
  "Gatepass creates a new branch and commits the changes there.",
  "Your default branch is never written to.",
  "CI configuration is never modified — no workflow, pipeline, or action file is touched.",
  "Nothing is merged. The pull request is opened and left for you to decide on.",
  "Every change is advisory and must be reviewed before it lands.",
];

/**
 * Confirmation step for the only action in this dashboard that writes to a
 * customer repository.
 *
 * Modelled on `ScanRepoDialog` — same scrim, same focus trap, same Escape
 * handling — because a second dialog pattern would be a second set of keyboard
 * bugs. Every failure renders through `ErrorPanel`: this route has six distinct
 * refusals (org not opted in, no applicable fix, branch exists, no GitHub repo,
 * CI-config-only, feature unconfigured) and `explainError` already turns each
 * into a sentence, so none of them is matched on here.
 */
function FixPullRequestDialog({
  scanId,
  fixes,
  onClose,
}: {
  scanId: string;
  fixes: ApplicableFix[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const orgId = useOrgId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<FixPullRequestResult | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Keep Tab inside the dialog — a modal that leaks focus to the page behind
      // it is not actually modal for keyboard users.
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);

  /* One file can carry several edits, so the count of files written is not the
     count of findings — both are stated rather than one standing in for the other. */
  const files = useMemo(() => [...new Set(fixes.map((f) => f.edit.path))].sort(), [fixes]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Only the fixes listed above are requested by fingerprint, so what the
      // confirmation step showed is exactly what the branch can contain.
      const res = await api.openFixPullRequest(orgId, scanId, {
        fingerprints: fixes.map((f) => f.finding.fingerprint),
      });
      setResult(res);
      toast(`Pull request #${res.number} opened on ${res.branch}`, "success");
    } catch (e) {
      setError(e);
      toast(errorToast(e, FIX_PR_CONTEXT), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-pr-dialog-title"
        className="animate-gp-rise gp-card relative w-full max-w-xl border-line-strong"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="fix-pr-dialog-title" className="text-[1rem] font-medium tracking-[-0.02em] text-fg">
              {result ? "Fix pull request opened" : "Open a fix pull request"}
            </h2>
            <p className="mt-1 text-[0.78rem] leading-relaxed text-fg-muted">
              {result
                ? "Review it as you would any other pull request. Gatepass will not touch it again."
                : "Nothing has been written yet. This is exactly what happens when you confirm."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mt-1 -mr-1 cursor-pointer rounded-full p-2 text-fg-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {result ? (
          <FixPullRequestResultView result={result} onClose={onClose} />
        ) : (
          <div className="space-y-4 px-5 py-5">
            <ul className="space-y-2 rounded-[0.75rem] border border-line bg-sunken px-4 py-3.5">
              {FIX_PR_GUARANTEES.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[0.82rem] leading-relaxed text-fg-secondary">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-verified" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <section>
              <SectionLabel>Included</SectionLabel>
              <p className="mt-1.5 text-[0.78rem] text-fg-muted">
                <span data-numeric>{fixes.length}</span> {pluralize(fixes.length, "finding")} across{" "}
                <span data-numeric>{files.length}</span> {pluralize(files.length, "file")}.
              </p>
              <ul className="mt-2 max-h-[14rem] space-y-1.5 overflow-y-auto rounded-[0.6rem] border border-line bg-sunken p-2.5">
                {fixes.map(({ finding, edit }) => (
                  <li key={finding.fingerprint} className="min-w-0">
                    <span className="block text-[0.8rem] font-medium break-words text-fg">{finding.classId}</span>
                    <span className="mt-0.5 block font-mono text-[0.72rem] break-all text-fg-muted">
                      {edit.path}:{edit.startLine}-{edit.endLine}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Ternary, not `&&`: the thrown value is `unknown`, which is not a
                ReactNode, so the short-circuit form does not typecheck. */}
            {error !== null ? (
              <ErrorPanel error={error} context={FIX_PR_CONTEXT} onRetry={() => void submit()} />
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                ref={confirmRef}
                type="button"
                variant="primary"
                size="md"
                onClick={() => void submit()}
                isLoading={busy}
              >
                {!busy && <GitPullRequest size={15} aria-hidden="true" />}
                {busy ? "Opening…" : "Open pull request"}
              </Button>
            </div>
            <p aria-live="polite" className="text-[0.72rem] text-fg-muted">
              {busy ? "Creating the branch, committing the changes, and opening the pull request." : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The server's own account of what it wrote — including what it declined to. */
function FixPullRequestResultView({ result, onClose }: { result: FixPullRequestResult; onClose: () => void }) {
  return (
    <div className="space-y-4 px-5 py-5">
      <p className="text-[0.855rem] text-fg">
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex cursor-pointer items-center gap-1.5 text-accent hover:underline"
        >
          Pull request #{result.number}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </p>
      <p className="font-mono text-[0.74rem] break-all text-fg-muted">
        {result.branch} → {result.base}
      </p>

      <section>
        <SectionLabel>Files written</SectionLabel>
        <ul className="mt-2 space-y-1">
          {result.files.map((path) => (
            <li key={path} className="font-mono text-[0.76rem] break-all text-fg-secondary">
              {path}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[0.78rem] text-fg-muted">
          <span data-numeric>{result.applied.length}</span> {pluralize(result.applied.length, "fix", "fixes")} applied.
        </p>
      </section>

      {result.skipped.length > 0 && (
        <section>
          <SectionLabel>Not applied</SectionLabel>
          <ul className="mt-2 space-y-2">
            {result.skipped.map((skip) => (
              <li
                key={skip.fingerprint}
                className={cx("min-w-0 rounded-[0.6rem] border px-3 py-2.5", TONE_SOFT.neutral)}
              >
                <span className="block text-[0.8rem] font-medium break-words text-fg">{skip.classId}</span>
                <span className="mt-0.5 block font-mono text-[0.72rem] break-all text-fg-muted">{skip.path}</span>
                <span className="mt-1 block text-[0.78rem] leading-relaxed text-fg-secondary">{skip.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-end pt-1">
        <Button type="button" variant="primary" size="md" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
