import { scoreBand } from "@/lib/scoring";
import { cn } from "@/lib/utils";

/**
 * A score, never alone.
 *
 * The Fairness Doctrine forbids showing a raw score without volume context: a
 * 92 carrying four milestones and a 92 carrying nineteen are not the same
 * achievement, and a number on its own invites the wrong comparison. This is
 * the only component that renders a member's score, so the rule holds by
 * construction rather than by everyone remembering it.
 *
 * Three sizes, one shape: score · on-time % · load.
 */

export type PerformanceFigures = {
  score: number;
  /** Null when nothing has been judged yet — an em dash, not a red 0%. */
  onTimeRate: number | null;
  load: number;
  totalWeight?: number;
};

export function PerformanceBadge({
  figures,
  size = "md",
  className,
  align = "start",
}: {
  figures: PerformanceFigures;
  size?: "sm" | "md" | "lg";
  className?: string;
  align?: "start" | "end";
}) {
  const band = scoreBand(figures.score);
  const { onTimeRate, load } = figures;

  const scoreSize =
    size === "lg" ? "text-[28px]" : size === "md" ? "text-lg" : "text-[15px]";
  const metaSize = size === "lg" ? "text-[13px]" : "text-[12px]";

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        align === "end" ? "items-end text-right" : "items-start",
        className,
      )}
    >
      <span
        className={cn(
          "font-display font-extrabold leading-none tracking-[-0.02em] tabular-nums",
          scoreSize,
        )}
        style={{ color: band.color }}
      >
        {formatScoreValue(figures.score)}
      </span>

      <span className={cn("tabular-nums text-ink/50", metaSize)}>
        {onTimeRate === null ? "—" : `${onTimeRate}% on time`}
        <span className="px-1 text-ink/25">·</span>
        {load} {load === 1 ? "task" : "tasks"}
        {figures.totalWeight !== undefined && load > 0 && (
          <span className="text-ink/35"> · weight {figures.totalWeight}</span>
        )}
      </span>
    </div>
  );
}

/**
 * The same triple on one line, for tables and lists where a stacked block
 * would break the row rhythm.
 */
export function PerformanceInline({
  figures,
  className,
}: {
  figures: PerformanceFigures;
  className?: string;
}) {
  const band = scoreBand(figures.score);

  return (
    <span className={cn("inline-flex items-baseline gap-1.5 tabular-nums", className)}>
      <span className="font-display text-sm font-bold" style={{ color: band.color }}>
        {formatScoreValue(figures.score)}
      </span>
      <span className="text-[12px] text-ink/45">
        · {figures.onTimeRate === null ? "—" : `${figures.onTimeRate}%`} ·{" "}
        {figures.load} {figures.load === 1 ? "task" : "tasks"}
      </span>
    </span>
  );
}

/**
 * The footnote that goes under any list ranking members. Without it the
 * leaderboard reads as a ranking of people rather than of workloads.
 */
export function VolumeFootnote({ className }: { className?: string }) {
  return (
    <p className={cn("text-[12px] leading-relaxed text-ink/40", className)}>
      Scores are volume-adjusted context — compare on-time rate across different
      workloads, not the raw number.
    </p>
  );
}

/** Whole numbers unless a half-point adjustment landed. */
export function formatScoreValue(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
