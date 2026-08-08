import { cn } from "@/lib/utils";
import { initialsFor } from "@/lib/constants";

export interface AvatarProps {
  name: string;
  /** Hex from AVATAR_COLORS; stored per user so the chip is stable. */
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

/** Initial-based avatar chip — no image uploads anywhere in the product. */
export function Avatar({ name, color = "#1A6B3A", size = "md", className }: AvatarProps) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-pill font-display font-bold uppercase tracking-wide text-paper",
        SIZES[size],
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
