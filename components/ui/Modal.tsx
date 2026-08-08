"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Uppercase label above the title. */
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  /** Sticky action row pinned to the bottom of the panel. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Set while a request is in flight so the dialog can't be dismissed mid-save. */
  busy?: boolean;
}

const SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  children,
  footer,
  size = "md",
  busy = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape to dismiss, and lock background scroll while open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, busy]);

  // Move focus into the panel so keyboard users land inside the dialog.
  useEffect(() => {
    if (!open) return;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([data-modal-close])",
    );
    focusable?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <button
        type="button"
        aria-label="Close dialog"
        data-modal-close
        onClick={() => !busy && onClose()}
        className="fixed inset-0 h-full w-full cursor-default bg-ink/40 animate-fade-in backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        className={cn(
          "relative w-full animate-scale-in rounded-t-card border border-line bg-white sm:rounded-card",
          SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            {eyebrow && (
              <p className="eyebrow mb-1.5 text-brand">{eyebrow}</p>
            )}
            <h2
              id="modal-title"
              className="font-display text-xl font-bold tracking-tight text-ink"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-sm leading-relaxed text-ink/60">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-pill p-2 text-ink/40 transition-colors hover:bg-cream hover:text-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 sm:px-6">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line bg-cream/60 px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
