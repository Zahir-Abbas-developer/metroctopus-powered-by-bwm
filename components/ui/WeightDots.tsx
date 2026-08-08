import { WEIGHT_LABEL, WEIGHT_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * A milestone's weight as filled dots. Compact enough for a table row, and it
 * reads as "how much this one matters" without a legend — which matters,
 * because weight is the multiplier behind every scoring deduction.
 */
export function WeightDots({
  weight,
  className,
  onDark = false,
}: {
  weight: number;
  className?: string;
  onDark?: boolean;
}) {
  const label = WEIGHT_LABEL[weight] ?? `Weight ${weight}`;

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={`${label} — weight ${weight} of ${WEIGHT_MAX}`}
      aria-label={`Weight ${weight} of ${WEIGHT_MAX}, ${label}`}
    >
      {Array.from({ length: WEIGHT_MAX }).map((_, index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-pill transition-colors",
            index < weight
              ? weight >= 5
                ? "bg-danger"
                : weight >= 4
                  ? "bg-warn"
                  : "bg-brand"
              : onDark
                ? "bg-paper/15"
                : "bg-line",
          )}
        />
      ))}
    </span>
  );
}
