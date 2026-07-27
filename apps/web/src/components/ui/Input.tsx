"use client";

import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef, useId } from "react";
import { cx } from "@/lib/utils";

const fieldBase =
  "w-full rounded-[0.6rem] border bg-sunken px-3 text-[0.855rem] text-fg placeholder:text-fg-faint " +
  "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, className = "", id, ...props }, ref) => {
    const auto = useId();
    const inputId = id ?? auto;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-[0.78rem] font-medium text-fg-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cx(
            fieldBase,
            "h-10",
            error ? "border-critical-line" : "border-line hover:border-line-strong",
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-[0.72rem] text-fg-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} role="alert" className="text-[0.72rem] text-critical">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, className = "", id, rows = 3, ...props }, ref) => {
    const auto = useId();
    const fieldId = id ?? auto;
    const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={fieldId} className="text-[0.78rem] font-medium text-fg-secondary">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          className={cx(
            fieldBase,
            "resize-y py-2.5 leading-relaxed",
            error ? "border-critical-line" : "border-line hover:border-line-strong",
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {hint && !error && (
          <p id={`${fieldId}-hint`} className="text-[0.72rem] text-fg-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${fieldId}-error`} role="alert" className="text-[0.72rem] text-critical">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
