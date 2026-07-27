import Link from "next/link";
import { Compass } from "lucide-react";

/*
 * Renders inside the root layout, so the rail and its container padding are
 * already present — this only owns the centred block.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-raised text-fg-muted">
        <Compass className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-5 text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Error 404</p>
      <h1 className="mt-2 text-[1.6rem] leading-tight font-medium tracking-[-0.03em] text-fg">Page not found</h1>
      <p className="mt-2 max-w-sm text-[0.855rem] leading-relaxed text-fg-muted">
        This route is not part of the dashboard. It may have moved, or the link that brought you here may be out of
        date.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-action px-4 text-[0.855rem] font-medium text-action-text transition-colors duration-150 hover:bg-action-hover"
      >
        Back to overview
      </Link>
    </div>
  );
}
