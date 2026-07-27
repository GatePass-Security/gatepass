import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Button } from "./Button";

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

/** Consistent, non-alarming failure surface for a route that could not load. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-critical-line bg-critical-soft px-5 py-4">
      <p className="text-[0.875rem] font-medium text-critical">{title}</p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-fg-secondary">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
