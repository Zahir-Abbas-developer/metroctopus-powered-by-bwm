import { scoreBand } from "@/lib/scoring";
import { cn } from "@/lib/utils";

export interface ScoreRingProps {
  /** 0–100. */
  score: number;
  size?: "xs" | "sm" | "md" | "lg";
  /** Hides the number, for dense table cells. */
  showValue?: boolean;
  /** Band name under the figure. */
  showLabel?: boolean;
  className?: string;
  onDark?: boolean;
}

const SIZES = {
  xs: { box: 30, stroke: 3.5, value: "text-[10px]" },
  sm: { box: 44, stroke: 4, value: "text-xs" },
  md: { box: 96, stroke: 7, value: "text-2xl" },
  lg: { box: 148, stroke: 9, value: "text-[42px]" },
};

/**
 * The score as a ring, coloured by band. An SVG rather than a chart library —
 * it's one arc, and shipping a dependency for it would be silly.
 */
export function ScoreRing({
  score,
  size = "md",
  showValue = true,
  showLabel = false,
  className,
  onDark = false,
}: ScoreRingProps) {
  const band = scoreBand(score);
  const { box, stroke, value } = SIZES[size];

  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference;

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: box, height: box }}>
        <svg
          width={box}
          height={box}
          viewBox={`0 0 ${box} ${box}`}
          role="img"
          aria-label={`Score ${Math.round(score)} out of 100 — ${band.label}`}
          // Start the arc at 12 o'clock instead of 3.
          className="-rotate-90"
        >
          <circle
            cx={box / 2}
            cy={box / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className={onDark ? "stroke-paper/15" : "stroke-line"}
          />
          <circle
            cx={box / 2}
            cy={box / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={band.color}
            strokeDasharray={`${filled} ${circumference}`}
            className="transition-all duration-700"
          />
        </svg>

        {showValue && (
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center font-display font-extrabold tabular-nums",
              value,
              onDark ? "text-paper" : "text-ink",
            )}
          >
            {Math.round(score)}
          </span>
        )}
      </div>

      {showLabel && (
        <span
          className="eyebrow"
          style={{ color: band.color }}
        >
          {band.label}
        </span>
      )}
    </div>
  );
}
