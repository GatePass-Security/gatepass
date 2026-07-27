"use client";

import { useId } from "react";
import { cx } from "@/lib/utils";

/**
 * Switch built on a real `role="switch"` button with an associated label, so
 * it is reachable, announced, and toggleable from the keyboard — the previous
 * implementation was an unlabelled `<button>` with no state exposed at all.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="min-w-0">
        <label htmlFor={id} className="block text-[0.855rem] font-medium text-fg">
          {label}
        </label>
        {description && <span className="mt-0.5 block text-[0.75rem] text-fg-muted">{description}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-45",
          checked ? "border-accent-line bg-accent-solid" : "border-line-strong bg-raised",
        )}
      >
        <span
          className={cx(
            "inline-block h-4 w-4 rounded-full transition-transform duration-150",
            checked ? "translate-x-[1.5rem] bg-accent-contrast" : "translate-x-[0.2rem] bg-fg-muted",
          )}
        />
      </button>
    </div>
  );
}
