import { cn } from "@/lib/utils";

export interface ProgressBarProps {
  /** 0–100. Values outside the range are clamped rather than overflowing. */
  value: number;
  tone?: "brand" | "warn" | "danger" | "ink";
  size?: "sm" | "md";
  label?: string;
  showValue?: boolean;
  className?: string;
  /** Renders for dark surfaces, where the track needs to be lighter not darker. */
  onDark?: boolean;
}

const TONES = {
  brand: "bg-brand",
  warn: "bg-warn",
  danger: "bg-danger",
  ink: "bg-ink",
};

export function ProgressBar({
  value,
  tone = "brand",
  size = "md",
  label,
  showValue = false,
  className,
  onDark = false,
}: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && (
            <span className={cn("eyebrow", onDark ? "text-paper/40" : "text-ink/45")}>
              {label}
            </span>
          )}
          {showValue && (
            <span
              className={cn(
                "font-display text-[13px] font-bold tabular-nums",
                onDark ? "text-paper/80" : "text-ink/70",
              )}
            >
              {percent}%
            </span>
          )}
        </div>
      )}

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
        className={cn(
          "w-full overflow-hidden rounded-pill",
          size === "sm" ? "h-1.5" : "h-2",
          onDark ? "bg-paper/10" : "bg-cream",
        )}
      >
        <div
          className={cn("h-full rounded-pill transition-all duration-500", TONES[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
