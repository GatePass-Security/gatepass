import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Loading placeholder shaped like the compliance page it stands in for.
 *
 * The generic `PageSkeleton` was doing this job and got the geometry wrong in
 * four places: it drew a four-up stat row where compliance has a five-up
 * standards grid, no score panel at all where the real page opens with a 96px
 * ring, no filter row, and uniform short rows where the check list is a run of
 * taller cards. The result jumped on every load — content shifted vertically the
 * moment the scan resolved, which is the exact thing a skeleton exists to
 * prevent.
 *
 * Each block below mirrors the element it replaces, at the same height and the
 * same responsive column count as `ComplianceClient`.
 */
export function ComplianceSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Running the compliance scan</span>

      {/* PageHeader: title, description, right-aligned scan metadata */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Skeleton variant="bare" className="h-7 w-64 rounded-md" />
          <Skeleton variant="bare" className="h-4 w-full max-w-2xl rounded-md" />
        </div>
        <div className="hidden shrink-0 space-y-1.5 sm:block">
          <Skeleton variant="bare" className="h-3 w-28 rounded-md" />
          <Skeleton variant="bare" className="h-3 w-20 rounded-md" />
        </div>
      </div>

      {/* Overall score: the ring, then headline + summary + four badges */}
      <div className="gp-card p-5">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <Skeleton variant="bare" className="h-24 w-24 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton variant="bare" className="h-5 w-56 rounded-md" />
            <Skeleton variant="bare" className="h-4 w-72 max-w-full rounded-md" />
            {/* Keyed by index, not by the width class — the real page repeats
                badge widths, so a class-name key collides. */}
            <div className="flex flex-wrap gap-2 pt-2">
              {["w-24", "w-20", "w-28", "w-32"].map((w, i) => (
                <Skeleton key={i} variant="bare" className={`h-5 ${w} rounded-full`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Five per-standard cards — same breakpoints as the real grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="gp-card space-y-2.5 p-4">
            <Skeleton variant="bare" className="h-3 w-16 rounded-md" />
            <Skeleton variant="bare" className="h-6 w-14 rounded-md" />
            <Skeleton variant="bare" className="h-3 w-20 rounded-md" />
          </div>
        ))}
      </div>

      {/* Status segmented control + domain filter pills + the result count */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton variant="bare" className="h-9 w-52 rounded-full" />
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          {["w-28", "w-20", "w-20", "w-24", "w-20", "w-16"].map((w, i) => (
            <Skeleton key={i} variant="bare" className={`h-8 ${w} rounded-full`} />
          ))}
        </div>
        <Skeleton variant="bare" className="h-3.5 w-40 rounded-md" />
      </div>

      {/* The check list: taller cards, each an icon + title row over a description */}
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="gp-card p-4">
            <div className="flex items-start gap-3">
              <Skeleton variant="bare" className="h-4 w-4 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton variant="bare" className="h-4 w-72 max-w-full rounded-md" />
                  <Skeleton variant="bare" className="h-4 w-16 rounded-full" />
                  <Skeleton variant="bare" className="h-4 w-14 rounded-full" />
                </div>
                <Skeleton variant="bare" className="h-3.5 w-full max-w-3xl rounded-md" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
