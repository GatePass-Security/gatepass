import type { ReactNode } from "react";
import { AlertTriangle, Clock, Inbox, Lock, SearchX, Settings2, WifiOff } from "lucide-react";
import { Button } from "./Button";
import { cx } from "@/lib/utils";
import { explainError, type ErrorContext, type ErrorKind, type FriendlyError } from "@/lib/errors";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void } | ReactNode;
}

function isActionSpec(a: EmptyStateProps["action"]): a is { label: string; onClick: () => void } {
  return typeof a === "object" && a !== null && "label" in a && "onClick" in a;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="gp-card flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-raised text-fg-muted">
        {icon ?? <Inbox className="h-5 w-5" />}
      </span>
      <h3 className="mt-4 text-[0.95rem] font-medium text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[0.82rem] leading-relaxed text-fg-muted">{description}</p>}
      {action &&
        (isActionSpec(action) ? (
          <Button variant="primary" size="md" className="mt-5" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : (
          <div className="mt-5">{action}</div>
        ))}
    </div>
  );
}

/**
 * Failure surface for a route or panel that could not load.
 *
 * Takes a `FriendlyError` rather than a string, so every failure in the product
 * reads the same way: what happened, then what to do about it, with the API's
 * raw message tucked into a disclosure instead of used as the headline.
 *
 * Not every failure is red. A missing GitHub App or a feature that is off for
 * the org is a configuration gap, not a fault — painting those critical trains
 * people to ignore the colour that means a scan actually broke.
 */
const KIND_STYLE: Record<ErrorKind, { frame: string; title: string; icon: ReactNode }> = {
  offline: { frame: "border-medium-line bg-medium-soft", title: "text-medium", icon: <WifiOff size={16} /> },
  timeout: { frame: "border-medium-line bg-medium-soft", title: "text-medium", icon: <Clock size={16} /> },
  rateLimited: { frame: "border-medium-line bg-medium-soft", title: "text-medium", icon: <Clock size={16} /> },
  unconfigured: { frame: "border-line-strong bg-raised", title: "text-fg", icon: <Settings2 size={16} /> },
  notFound: { frame: "border-line-strong bg-raised", title: "text-fg", icon: <SearchX size={16} /> },
  denied: { frame: "border-line-strong bg-raised", title: "text-fg", icon: <Lock size={16} /> },
  invalid: { frame: "border-high-line bg-high-soft", title: "text-high", icon: <AlertTriangle size={16} /> },
  server: { frame: "border-critical-line bg-critical-soft", title: "text-critical", icon: <AlertTriangle size={16} /> },
  unknown: {
    frame: "border-critical-line bg-critical-soft",
    title: "text-critical",
    icon: <AlertTriangle size={16} />,
  },
};

export function ErrorState({
  error,
  onRetry,
  className = "",
}: {
  error: FriendlyError;
  onRetry?: () => void;
  className?: string;
}) {
  const style = KIND_STYLE[error.kind];

  return (
    <div role="alert" className={cx("rounded-[var(--radius-card)] border px-5 py-4", style.frame, className)}>
      <div className="flex items-start gap-3">
        <span className={cx("mt-px shrink-0", style.title)} aria-hidden="true">
          {style.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx("text-[0.875rem] font-medium", style.title)}>{error.title}</p>
          <p className="mt-1 text-[0.82rem] leading-relaxed text-fg-secondary">{error.detail}</p>
          {error.action && <p className="mt-2 text-[0.82rem] leading-relaxed text-fg-secondary">{error.action}</p>}

          {(onRetry || error.technical) && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {onRetry && error.retryable && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              )}
              {onRetry && !error.retryable && (
                <Button variant="ghost" size="sm" onClick={onRetry}>
                  Reload
                </Button>
              )}
              {error.technical && (
                <details className="min-w-0">
                  <summary className="cursor-pointer text-[0.75rem] text-fg-muted transition-colors hover:text-fg">
                    Technical detail
                  </summary>
                  <p className="mt-1.5 font-mono text-[0.72rem] break-words text-fg-muted">
                    {error.status ? `${error.status} · ` : ""}
                    {error.technical}
                  </p>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Convenience wrapper: interpret and render in one step. */
export function ErrorPanel({
  error,
  context,
  onRetry,
  className,
}: {
  error: unknown;
  context?: ErrorContext;
  onRetry?: () => void;
  className?: string;
}) {
  return <ErrorState error={explainError(error, context)} onRetry={onRetry} className={className} />;
}
