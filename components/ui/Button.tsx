import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-paper border border-brand hover:bg-brand/90 active:bg-brand disabled:bg-brand/50 disabled:border-brand/50",
  secondary:
    "bg-paper text-ink border border-line hover:bg-cream active:bg-cream disabled:text-ink/40",
  ghost:
    "bg-transparent text-ink/70 border border-transparent hover:bg-cream hover:text-ink disabled:text-ink/30",
  danger:
    "bg-danger-tint text-danger border border-danger/25 hover:bg-danger hover:text-paper hover:border-danger disabled:opacity-50",
  dark: "bg-ink text-paper border border-ink hover:bg-ink/90 disabled:bg-ink/50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

/** Base classes shared with link-styled-as-button call sites. */
export const buttonClasses = (
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) =>
  cn(
    "inline-flex items-center justify-center rounded-pill font-medium transition-colors duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
    "disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && "w-full", className))}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
