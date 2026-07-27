import type { ReactNode } from "react";

/**
 * Every route opens with this. The display treatment — medium weight, tight
 * tracking, a muted single-line subtitle — is lifted from the marketing
 * headline, scaled down for a working surface.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.6rem] leading-tight font-medium tracking-[-0.03em] text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[0.855rem] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
