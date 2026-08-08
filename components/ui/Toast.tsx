"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Toasts for the outcome of a mutation.
 *
 * Deliberately small: success, error, info. Anything needing more than a line
 * of explanation belongs inline on the form, not in a corner that disappears.
 */

export type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastApi = {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TONES: Record<ToastTone, string> = {
  success: "border-brand/25 bg-brand-tint text-brand",
  error: "border-danger/25 bg-danger-tint text-danger",
  info: "border-info/25 bg-info-tint text-info",
};

/** Errors linger — you may need to read them twice. */
const DURATION: Record<ToastTone, number> = {
  success: 3600,
  error: 6000,
  info: 4200,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    let nextId = 0;

    const toast = (message: string, tone: ToastTone = "success") => {
      // Date.now() would collide when two mutations settle in the same tick.
      nextId += 1;
      const id = nextId;

      setToasts((current) => [...current.slice(-2), { id, tone, message }]);
      setTimeout(() => dismiss(id), DURATION[tone]);
    };

    return {
      toast,
      success: (message: string) => toast(message, "success"),
      error: (message: string) => toast(message, "error"),
    };
  }, [dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      {mounted &&
        createPortal(
          <div
            aria-live="polite"
            className="no-print pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2"
          >
            {toasts.map((toast) => {
              const Icon = ICONS[toast.tone];

              return (
                <div
                  key={toast.id}
                  role={toast.tone === "error" ? "alert" : "status"}
                  className={cn(
                    "pointer-events-auto flex animate-scale-in items-start gap-2.5 rounded-card border px-4 py-3 text-[13px] leading-relaxed shadow-[0_6px_24px_-12px_rgba(12,12,10,0.35)]",
                    TONES[toast.tone],
                  )}
                >
                  <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="flex-1">{toast.message}</span>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    aria-label="Dismiss"
                    className="-mr-1 -mt-0.5 rounded-pill p-1 opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
