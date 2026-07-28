import type { HTMLAttributes } from "react";
import { cx } from "@/lib/utils";

/**
 * `bare` contributes no geometry at all — only the pulse and the fill.
 *
 * The other variants each hard-code a height and width, and a caller's own
 * `h-*`/`w-*` in `className` does NOT reliably beat them: both are single-class
 * utilities of equal specificity, so the winner is whichever Tailwind happens to
 * emit later in the stylesheet, not whichever is written last in the attribute.
 * Any placeholder that needs its own dimensions should use `bare` and state them
 * outright rather than gamble on that ordering.
 */
type SkeletonVariant = "bare" | "text" | "card" | "stat" | "row" | "avatar";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
}

const variantStyles: Record<SkeletonVariant, string> = {
  // Truly nothing — not even a radius. A `rounded-md` here would fight a
  // caller's `rounded-full` for exactly the same reason the sizes do.
  bare: "",
  text: "h-4 w-full rounded-md",
  card: "h-40 w-full rounded-[var(--radius-card)]",
  stat: "h-[6.5rem] w-full rounded-[var(--radius-card)]",
  row: "h-12 w-full rounded-[0.6rem]",
  avatar: "h-9 w-9 rounded-full",
};

export function Skeleton({ variant = "text", className = "", ...props }: SkeletonProps) {
  return (
    <div
      className={cx("animate-gp-pulse bg-raised", variantStyles[variant], className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Page-level placeholder used by every route's `loading.tsx`, so the skeleton
 *  geometry matches the real layout instead of each route improvising one. */
export function PageSkeleton({ stats = 4, rows = 5 }: { stats?: number; rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      {stats > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={i} variant="stat" />
          ))}
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} variant="row" />
        ))}
      </div>
    </div>
  );
}
