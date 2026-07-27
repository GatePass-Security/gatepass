import type { HTMLAttributes } from "react";
import { cx } from "@/lib/utils";

type SkeletonVariant = "text" | "card" | "stat" | "row" | "avatar";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
}

const variantStyles: Record<SkeletonVariant, string> = {
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
