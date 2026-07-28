"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/utils";
import { TONE_FILL, TONE_SOFT, TONE_TEXT, type Tone } from "./Stat";

/**
 * Filter chip. Uses `aria-pressed` rather than styling alone, so the selected
 * state is exposed to assistive tech instead of being purely visual.
 */
export function FilterPill({
  active,
  onClick,
  tone,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** When set, the active chip adopts that data tone instead of the neutral one. */
  tone?: Tone;
  count?: number;
  children: ReactNode;
}) {
  const activeStyle = tone ? cx(TONE_SOFT[tone], TONE_TEXT[tone]) : "border-line-strong bg-raised text-fg";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.78rem] font-medium",
        "transition-colors duration-150",
        active ? activeStyle : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg",
      )}
    >
      {tone && (
        <span
          className={cx("h-1.5 w-1.5 shrink-0 rounded-full", active ? TONE_FILL[tone] : "bg-fg-muted")}
          aria-hidden="true"
        />
      )}
      {children}
      {typeof count === "number" && (
        <span data-numeric className="text-fg-muted">
          {count}
        </span>
      )}
    </button>
  );
}

/** Segmented control — a single-choice row of pills sharing one border. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              "cursor-pointer rounded-full px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors duration-150",
              active ? "bg-accent-soft text-accent" : "text-fg-muted hover:text-fg",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
