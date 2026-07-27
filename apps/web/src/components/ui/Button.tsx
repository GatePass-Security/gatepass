import { type ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "accent" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

/*
 * The marketing site's primary action is a high-contrast pill — white on
 * black — and the mint accent is spent on state and data instead. `primary`
 * follows that; reach for `accent` only when the action IS the accent story
 * (running a scan), so the accent keeps its meaning everywhere else.
 */
const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-action text-action-text hover:bg-action-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-raised",
  ghost: "text-fg-secondary hover:bg-raised hover:text-fg",
  accent: "bg-accent-solid text-accent-contrast hover:opacity-90",
  danger: "border border-critical-line bg-critical-soft text-critical hover:opacity-80",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[0.8rem] gap-1.5",
  md: "h-10 px-4 text-[0.855rem] gap-2",
  lg: "h-11 px-5 text-[0.9rem] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", isLoading = false, disabled, className = "", children, ...props }, ref) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        className={cx(
          "inline-flex cursor-pointer touch-manipulation items-center justify-center rounded-full font-medium whitespace-nowrap",
          "transition-[background-color,color,opacity,border-color] duration-150",
          "disabled:cursor-not-allowed disabled:opacity-45",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — an icon on its own has no accessible name. */
  label: string;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, size = "md", className = "", children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex cursor-pointer touch-manipulation items-center justify-center rounded-full",
        "text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg",
        "disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-9 w-9" : "h-10 w-10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = "IconButton";
