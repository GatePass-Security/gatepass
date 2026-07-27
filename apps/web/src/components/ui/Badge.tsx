import type { HTMLAttributes } from "react";
import { cx } from "@/lib/utils";
import { TONE_FILL, TONE_SOFT, TONE_TEXT, type Tone } from "./Stat";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /**
   * Show a leading dot. The label always carries the meaning — colour is never
   * the only channel — so the dot is reinforcement, not the message.
   */
  dot?: boolean;
  size?: "sm" | "md";
}

export function Badge({ tone = "neutral", dot = false, size = "md", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[0.65rem]" : "px-2.5 py-0.5 text-[0.7rem]",
        TONE_SOFT[tone],
        tone === "neutral" ? "text-fg-secondary" : TONE_TEXT[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", TONE_FILL[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}
