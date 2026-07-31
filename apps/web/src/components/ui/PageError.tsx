"use client";

import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "./Button";
import { InlineCode } from "./InlineCode";
import { BrandLockup } from "@/components/Brand";

/**
 * The failure surface for a whole page, as opposed to `ErrorState`, which is a panel inside one.
 *
 * It exists because the alternative was worse in a specific way: a page that could not render
 * used to drop the reader onto bare text with a raw exception string under it — `fetch failed`
 * — and no way forward except knowing to press the browser's reload button. Someone who did not
 * write this code cannot tell from `fetch failed` whether they broke something, whether their
 * work was lost, or whether waiting will help.
 *
 * So the shape here is fixed and the same everywhere:
 *
 * 1. The brand, so the page still looks like Gatepass rather than like a crashed browser tab.
 * 2. A headline in plain words — what is wrong, not which call rejected.
 * 3. Reassurance when it is true, because "is my session gone?" is the first question.
 * 4. A button that actually does the next step, rather than an instruction to do it.
 * 5. Operator and technical detail last, collapsed, for the reader who *is* the operator.
 *
 * The ordering is the point. Everything an ordinary reader needs is above everything only a
 * person with shell access can use.
 */
export function PageError({
  icon,
  title,
  children,
  onRetry,
  retryLabel = "Try again",
  secondary,
  operator,
  technical,
}: {
  icon: ReactNode;
  /** Plain words, sentence case. What is wrong from the reader's side. */
  title: string;
  /** One or two sentences: what happened, and whether anything was lost. */
  children: ReactNode;
  /** Omit to fall back to a full reload, which is right for a server-rendered page. */
  onRetry?: () => void;
  retryLabel?: string;
  /** An escape hatch next to the retry — usually a link somewhere that still works. */
  secondary?: ReactNode;
  /**
   * What an operator would have to change. Demoted, because most readers are not one. A string
   * gets `backtick` spans typeset; pass a node when the copy needs more than that.
   */
  operator?: ReactNode;
  /** The original exception text. Collapsed: it is for a bug report, not for reading. */
  technical?: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-16">
      <BrandLockup size={28} />

      <div className="mt-8" role="alert">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-raised text-fg-muted">
          {icon}
        </span>
        <h1 className="mt-5 text-[1.35rem] leading-tight font-medium tracking-[-0.02em] text-fg">{title}</h1>
        <div className="mt-2.5 space-y-2 text-[0.855rem] leading-relaxed text-fg-secondary">{children}</div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={onRetry ?? (() => window.location.reload())}
            className="cursor-pointer"
          >
            <RotateCw size={15} aria-hidden="true" />
            {retryLabel}
          </Button>
          {secondary}
        </div>

        {(operator || technical) && (
          <details className="mt-8 border-t border-line pt-4">
            <summary className="cursor-pointer text-[0.78rem] text-fg-muted transition-colors hover:text-fg">
              Details for whoever runs this deployment
            </summary>
            {operator && (
              <div className="mt-3 text-[0.78rem] leading-relaxed text-fg-secondary">
                {typeof operator === "string" ? <InlineCode text={operator} /> : operator}
              </div>
            )}
            {technical && <p className="mt-3 font-mono text-[0.72rem] break-words text-fg-muted">{technical}</p>}
          </details>
        )}
      </div>
    </main>
  );
}
