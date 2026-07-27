import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  footer?: ReactNode;
  padding?: boolean;
}

export function Card({ header, footer, padding = true, className = "", children, ...props }: CardProps) {
  return (
    <div className={cx("gp-card overflow-hidden", className)} {...props}>
      {header && <div className="border-b border-line px-5 py-3.5">{header}</div>}
      <div className={padding ? "p-5" : ""}>{children}</div>
      {footer && <div className="border-t border-line px-5 py-3.5">{footer}</div>}
    </div>
  );
}

/**
 * Section title used inside a Card header — small, tracked-out, muted. Keeps
 * every panel heading identical across pages instead of each page inventing
 * its own type treatment.
 */
export function CardTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 text-[0.82rem] font-medium text-fg">
        {icon && <span className="shrink-0 text-fg-muted">{icon}</span>}
        <span className="truncate">{children}</span>
      </h2>
      {action}
    </div>
  );
}
