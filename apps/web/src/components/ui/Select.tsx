"use client";

import { type SelectHTMLAttributes, forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className = "", id, ...props }, ref) => {
    const auto = useId();
    const selectId = id ?? auto;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-[0.78rem] font-medium text-fg-secondary">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cx(
              "h-10 w-full cursor-pointer appearance-none rounded-[0.6rem] border bg-sunken pr-9 pl-3",
              "text-[0.855rem] text-fg transition-colors duration-150",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error ? "border-critical-line" : "border-line hover:border-line-strong",
              className,
            )}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${selectId}-error` : undefined}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-fg-muted"
            aria-hidden="true"
          />
        </div>
        {error && (
          <p id={`${selectId}-error`} role="alert" className="text-[0.72rem] text-critical">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";
