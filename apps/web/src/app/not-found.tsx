import Link from "next/link";
import { Compass } from "lucide-react";

/*
 * Renders inside the *root* layout, which carries no product chrome — so there is no sidebar
 * around this and it owns the whole viewport, not a centred block inside a rail.
 *
 * Both exits are offered because this one page is reached from two different places. A visitor
 * who mistyped a marketing URL wants the home page; someone who followed a stale link out of
 * the product wants the dashboard. The old single "Back to overview" button pointed at `/`,
 * which is the marketing site — so the label promised the overview and the link delivered the
 * landing page, leaving a signed-in reader one hop further from where they were going.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-raised text-fg-muted">
        <Compass className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-5 text-[0.72rem] font-medium tracking-[0.05em] text-fg-muted uppercase">Error 404</p>
      <h1 className="mt-2 text-[1.6rem] leading-tight font-medium tracking-[-0.03em] text-fg">Page not found</h1>
      <p className="mt-2 max-w-sm text-[0.855rem] leading-relaxed text-fg-muted">
        There is nothing at this address. The page may have moved, or the link that brought you here may be out of date.
        Nothing is broken — you are just somewhere that does not exist.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/dashboard"
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-action px-4 text-[0.855rem] font-medium text-action-text transition-colors duration-150 hover:bg-action-hover"
        >
          Go to the dashboard
        </Link>
        <Link
          href="/"
          className="text-[0.82rem] text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
        >
          Gatepass home
        </Link>
      </div>
    </div>
  );
}
