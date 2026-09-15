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
  /**
   * Scroll back to the top whenever this changes — pass a wizard's step.
   *
   * Without it, moving to the next step keeps the scroll position of the last
   * one. On a phone that lands the person halfway down a form whose first,
   * required fields are above them, with nothing to say they are there.
   */
  scrollKey?: string | number;
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
  scrollKey,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open || scrollKey === undefined) return;
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [open, scrollKey]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    /* The scroll container and the alignment container are two elements, and
       that is the fix for the dialog that could not be scrolled on a phone.

       They used to be one: `fixed inset-0 flex items-end overflow-y-auto`.
       Flex alignment positions the panel before overflow is worked out, so a
       panel taller than the screen, aligned to the bottom (or centred), spills
       its extra height out of the *top* of the container — and a browser only
       scrolls into overflow on the end side. The title and the first fields
       ended up above the screen with no way to reach them. The lead wizard's
       Business and Contact fields were among them, and Continue stays
       disabled until both are filled, so on a phone a lead could not be added
       at all; the client wizard lost its first fields the same way.

       Now the outer element only scrolls, and the inner one is at least as tall
       as the screen and does the aligning. A short panel still sits at the
       bottom as a sheet (or centred on larger screens); a tall one makes the
       inner element grow downwards, where scrolling can follow it. */
    <div
      ref={scrollerRef}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain"
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

      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-6">
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
            /* Sticky, as the prop has always promised: the actions stay in
               reach at the bottom of the screen while a long form scrolls
               underneath, rather than waiting at the very end of it. The
               background is opaque so fields do not show through. */
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2.5 border-t border-line bg-cream px-5 py-4 sm:rounded-b-card sm:px-6">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
