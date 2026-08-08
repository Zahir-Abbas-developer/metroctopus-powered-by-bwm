"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { labelClasses } from "@/components/ui/Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  requiredMark?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, requiredMark, className, id, rows = 4, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className={labelClasses}>
          {label}
          {requiredMark && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}

      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-[10px] border bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink transition-colors",
          "placeholder:text-ink/35",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25",
          "disabled:cursor-not-allowed disabled:bg-cream disabled:text-ink/40",
          error ? "border-danger focus:border-danger focus:ring-danger/20" : "border-line",
          className,
        )}
        {...props}
      />

      {error ? (
        <p id={`${fieldId}-error`} className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-[13px] text-ink/50">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
