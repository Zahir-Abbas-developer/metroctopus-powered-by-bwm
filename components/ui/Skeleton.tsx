import { cn } from "@/lib/utils";

/** Shimmering placeholder used by route-level loading states and tables. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-[10px] border border-line bg-cream",
        className,
      )}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}
