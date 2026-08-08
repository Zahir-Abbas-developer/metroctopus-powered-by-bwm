import { Sparkles, Trophy } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { StreakState } from "@/lib/incentives";

/**
 * A member's progress toward the excellence bonus.
 *
 * Motivation through visible upside, not fear. This is the only place in the
 * product that shows a member something they are *working towards* rather than
 * something they might lose — everything else is a deduction they can avoid.
 *
 * Deliberately says nothing about the performance-review rule. A member who is
 * having a bad run does not need a card counting down to a difficult
 * conversation; that is a conversation the owner should open in person, and
 * the scoring policy page states the rule for anyone who wants to know it.
 */
export function StreakCard({
  streak,
  threshold,
  bonusPercent,
}: {
  streak: StreakState;
  threshold: number;
  bonusPercent: number | null;
}) {
  // Nothing to show a member who has just started. A card reading "0 of 3"
  // frames a fresh start as a deficit.
  if (streak.months === 0 && !streak.earned) return null;

  const pips = Array.from({ length: streak.required }, (_, index) => index < streak.months);

  return (
    <Card className={cn(streak.earned && "border-brand/30 bg-brand-tint/30")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {streak.earned ? (
              <Trophy className="h-4 w-4 text-brand" />
            ) : (
              <Sparkles className="h-4 w-4 text-ink/40" />
            )}
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              {streak.earned ? "Excellence bonus earned" : "Excellence streak"}
            </h2>
          </div>

          <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
            {streak.earned
              ? `${streak.months} months at ${threshold} or above. The owner has been told${
                  bonusPercent ? ` — the standing bonus is ${bonusPercent}%` : ""
                }.`
              : `${streak.remaining} more month${streak.remaining === 1 ? "" : "s"} at ${threshold}+ and the bonus is yours.`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {pips.map((filled, index) => (
            <span
              key={index}
              className={cn(
                "h-2.5 w-8 rounded-pill transition-colors",
                filled ? "bg-brand" : "bg-cream",
              )}
            />
          ))}
          {streak.months > streak.required && (
            <span className="ml-1 text-[12px] font-medium tabular-nums text-brand">
              +{streak.months - streak.required}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
