"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper text below the field; replaced by `error` when one is present. */
  hint?: string;
  error?: string;
  icon?: ReactNode;
  /**
   * An interactive control inside the right edge of the field — a show/hide
   * toggle on a password, for instance. Unlike `icon` it receives clicks.
   */
  trailing?: ReactNode;
  /** Appends a required marker to the label. */
  requiredMark?: boolean;
}

export const fieldClasses = (hasError?: boolean, hasIcon?: boolean) =>
  cn(
    "w-full rounded-[10px] border bg-white text-sm text-ink transition-colors",
    "placeholder:text-ink/35",
    "focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand",
    "disabled:cursor-not-allowed disabled:bg-cream disabled:text-ink/40",
    "h-11 px-3.5",
    hasIcon && "pl-10",
    hasError ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line",
  );

export const labelClasses = "mb-1.5 block text-[13px] font-medium text-ink/80";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, trailing, requiredMark, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className={labelClasses}>
          {label}
          {requiredMark && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}

      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40"
          >
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(fieldClasses(Boolean(error), Boolean(icon)), trailing && "pr-11", className)}
          {...props}
        />
        {trailing && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>
        )}
      </div>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-[13px] text-ink/50">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
