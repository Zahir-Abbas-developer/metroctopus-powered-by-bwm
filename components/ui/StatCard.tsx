import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "success" | "warning" | "danger" | "info";

const ICON_TONES: Record<StatTone, string> = {
  neutral: "bg-cream text-ink/60 border-line",
  success: "bg-brand-tint text-brand border-brand/15",
  warning: "bg-warn-tint text-warn border-warn/15",
  danger: "bg-danger-tint text-danger border-danger/15",
  info: "bg-info-tint text-info border-info/15",
};

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Small unit rendered next to the value, e.g. "%" or "pts". */
  unit?: string;
  /** A short line under the figure. Takes a node so a trend arrow can live here. */
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: StatTone;
  /** Renders a shimmer placeholder in place of the value. */
  loading?: boolean;
  className?: string;
}

/** Dashboard metric tile — eyebrow label, oversized Syne figure, one-line hint. */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "neutral",
  loading = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-white p-5 transition-colors hover:border-ink/15",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow pt-1 text-ink/45">{label}</p>
        {Icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border",
              ICON_TONES[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="mt-5 flex items-baseline gap-1.5">
        {loading ? (
          <span className="relative block h-9 w-20 overflow-hidden rounded-md bg-cream">
            <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
          </span>
        ) : (
          <>
            <span className="font-display text-[34px] font-extrabold leading-none tracking-[-0.03em] text-ink">
              {value}
            </span>
            {unit && (
              <span className="font-display text-lg font-bold text-ink/35">{unit}</span>
            )}
          </>
        )}
      </div>

      {hint && <p className="mt-2.5 text-[13px] leading-snug text-ink/45">{hint}</p>}
    </div>
  );
}
