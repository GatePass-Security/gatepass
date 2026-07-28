import type { Severity, Tier, FleetPosture } from "./types";

/** Severity is ordinal — this is the canonical display order, worst first. */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const satisfies readonly Severity[];

/**
 * Token names, not colour values. Callers compose them into utilities
 * (`text-${severityToken(s)}`) so the theme layer owns the actual colour and
 * light/dark can never drift apart.
 */
const SEVERITY_TOKEN: Record<Severity, string> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

export function severityToken(severity: Severity): string {
  return SEVERITY_TOKEN[severity] ?? "low";
}

export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function tierToken(tier: Tier): string {
  return tier === "verified" ? "verified" : "research";
}

/** Fleet posture maps onto the severity/tier ramp rather than inventing a fifth palette. */
export const POSTURE_TOKEN: Record<FleetPosture, string> = {
  passing: "verified",
  findings_open: "medium",
  critical: "critical",
  unscanned: "low",
};

export const POSTURE_LABEL: Record<FleetPosture, string> = {
  passing: "Passing",
  findings_open: "Findings open",
  critical: "Critical",
  unscanned: "Unscanned",
};

/** Format confidence as a percentage string. */
export function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Coarse relative time — precise enough for a scan feed, cheap enough to run per row. */
export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 2_592_000) return `${Math.floor(secs / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** Last path segment — repo paths are absolute on the API host and too long to render. */
export function repoLabel(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Percentage of `part` in `total`, rendered so the number can never contradict
 * the counts displayed beside it.
 *
 * Plain `Math.round` is not safe here: 999 of 1000 rounds to "100%" while a
 * tile alongside it shows the remaining 1, and 1 of 1000 rounds to "0%" while
 * showing a non-zero count. Both read as the dashboard disagreeing with itself,
 * which is exactly the class of unearned number this product exists to
 * eliminate. So a partial share is clamped to the 1–99 band and a sub-1% share
 * says "<1%" rather than rounding away.
 *
 * Returns undefined when there is nothing to take a share of — callers should
 * omit the caption entirely rather than print "0%".
 */
export function sharePercent(part: number, total: number): string | undefined {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return undefined;
  if (part <= 0) return "0%";
  if (part >= total) return "100%";
  const exact = (part / total) * 100;
  if (exact < 1) return "<1%";
  if (exact > 99) return ">99%";
  return `${Math.round(exact)}%`;
}

/** Join class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
