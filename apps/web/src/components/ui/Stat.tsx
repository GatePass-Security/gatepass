import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

export type Tone = "verified" | "research" | "critical" | "high" | "medium" | "low" | "accent" | "neutral";

/*
 * Literal class maps, not `text-${tone}` interpolation — Tailwind only
 * generates class names it can see as literals in source, so a template string
 * would compile to nothing and silently fall back to inherited colour.
 */
export const TONE_TEXT: Record<Tone, string> = {
  verified: "text-verified",
  research: "text-research",
  critical: "text-critical",
  high: "text-high",
  medium: "text-medium",
  low: "text-low",
  accent: "text-accent",
  neutral: "text-fg",
};

export const TONE_FILL: Record<Tone, string> = {
  verified: "bg-verified",
  research: "bg-research",
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-low",
  accent: "bg-accent",
  neutral: "bg-fg-muted",
};

export const TONE_SOFT: Record<Tone, string> = {
  verified: "border-verified-line bg-verified-soft",
  research: "border-research-line bg-research-soft",
  critical: "border-critical-line bg-critical-soft",
  high: "border-high-line bg-high-soft",
  medium: "border-medium-line bg-medium-soft",
  low: "border-low-line bg-low-soft",
  accent: "border-accent-line bg-accent-soft",
  neutral: "border-line bg-raised",
};

/** CSS custom properties, for the places that need a raw colour (inline SVG,
 *  gradient stops) rather than a utility class. */
export const TONE_VAR: Record<Tone, string> = {
  verified: "var(--gp-verified)",
  research: "var(--gp-research)",
  critical: "var(--gp-critical)",
  high: "var(--gp-high)",
  medium: "var(--gp-medium)",
  low: "var(--gp-low)",
  accent: "var(--gp-accent)",
  neutral: "var(--gp-text-muted)",
};

interface StatProps {
  label: string;
  value: string | number;
  tone?: Tone;
  icon?: ReactNode;
  /** Short factual caption. Must be derived from data — never a filler claim. */
  caption?: string;
}

/**
 * The single stat tile used on every page. Consolidating it here is what stops
 * four pages from each inventing a slightly different metric card — the reason
 * the previous dashboard drifted into three different accent colours.
 */
export function Stat({ label, value, tone = "neutral", icon, caption }: StatProps) {
  return (
    <div className="gp-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">{label}</p>
        {icon && <span className="shrink-0 text-fg-muted">{icon}</span>}
      </div>
      <p
        data-numeric
        className={cx("mt-2.5 text-[1.75rem] leading-none font-medium tracking-[-0.03em]", TONE_TEXT[tone])}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {caption && <p className="mt-2 text-[0.72rem] text-fg-muted">{caption}</p>}
    </div>
  );
}
